import { createHash, createHmac } from 'node:crypto';
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
function hmac(key, value) {
    return createHmac('sha256', key).update(value, 'utf8').digest();
}
function encode(value) {
    return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
function encodeKey(key) {
    return key.split('/').map(encode).join('/');
}
function canonicalQuery(query) {
    return Object.entries(query)
        .map(([key, value]) => [encode(key), encode(value)])
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, value]) => `${key}=${value}`)
        .join('&');
}
function xmlEscape(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}
function xmlValue(xml, name) {
    const match = new RegExp(`<${name}>([^<]+)</${name}>`, 'u').exec(xml);
    return match?.[1];
}
export function assertObjectKey(key) {
    if (key.length < 1 ||
        key.length > 1024 ||
        key.startsWith('/') ||
        key.includes('\\') ||
        key.includes('\0') ||
        key.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
        !/^(quarantine|available|derivatives)\//u.test(key)) {
        throw new Error('OBJECT_KEY_INVALID');
    }
}
function assertExpiry(expiresSeconds) {
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 15 || expiresSeconds > 900) {
        throw new Error('SIGNED_URL_TTL_INVALID');
    }
}
export class S3ObjectStorage {
    constructor(options) {
        this.options = options;
        this.endpoint = new URL(options.endpoint);
        if (this.endpoint.username.length > 0 || this.endpoint.password.length > 0) {
            throw new Error('S3_ENDPOINT_CREDENTIALS_FORBIDDEN');
        }
        if (!/^[a-z0-9][a-z0-9.-]{1,62}$/u.test(options.bucket)) {
            throw new Error('S3_BUCKET_INVALID');
        }
        this.clock = options.clock ?? (() => new Date());
        this.fetcher = options.fetcher ?? fetch;
    }
    async createMultipartUpload(key, mediaType) {
        const response = await this.send({
            method: 'POST',
            key,
            query: { uploads: '' },
            headers: { 'content-type': mediaType },
        });
        const uploadId = xmlValue(await response.text(), 'UploadId');
        if (uploadId === undefined || uploadId.length === 0) {
            throw new Error('S3_UPLOAD_ID_MISSING');
        }
        return uploadId;
    }
    authorizeUploadPart(key, uploadId, partNumber, expiresSeconds) {
        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
            throw new Error('UPLOAD_PART_NUMBER_INVALID');
        }
        return Promise.resolve(this.presign('PUT', key, expiresSeconds, {
            partNumber: String(partNumber),
            uploadId,
        }));
    }
    async completeMultipartUpload(key, uploadId, parts) {
        if (parts.length === 0 ||
            parts.length > 10_000 ||
            parts.some((part, index) => !Number.isInteger(part.partNumber) ||
                part.partNumber !== index + 1 ||
                !/^"?[A-Za-z0-9+/=_-]{8,128}"?$/u.test(part.etag))) {
            throw new Error('UPLOAD_PARTS_INVALID');
        }
        const body = Buffer.from(`<CompleteMultipartUpload>${parts
            .map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`)
            .join('')}</CompleteMultipartUpload>`, 'utf8');
        await this.send({
            method: 'POST',
            key,
            query: { uploadId },
            headers: { 'content-type': 'application/xml' },
            body,
        });
    }
    async headObject(key) {
        const response = await this.send({ method: 'HEAD', key });
        const length = Number(response.headers.get('content-length'));
        if (!Number.isSafeInteger(length) || length < 0) {
            throw new Error('S3_CONTENT_LENGTH_INVALID');
        }
        return {
            sizeBytes: length,
            etag: response.headers.get('etag'),
            mediaType: response.headers.get('content-type'),
        };
    }
    async getObject(key) {
        const response = await this.send({ method: 'GET', key });
        return new Uint8Array(await response.arrayBuffer());
    }
    async putObject(key, bytes, mediaType) {
        await this.send({ method: 'PUT', key, headers: { 'content-type': mediaType }, body: bytes });
    }
    async copyObject(sourceKey, destinationKey, mediaType) {
        assertObjectKey(sourceKey);
        await this.send({
            method: 'PUT',
            key: destinationKey,
            headers: {
                'content-type': mediaType,
                'x-amz-copy-source': `/${this.options.bucket}/${encodeKey(sourceKey)}`,
                'x-amz-metadata-directive': 'REPLACE',
            },
        });
    }
    authorizeGet(key, expiresSeconds, filename) {
        const query = {};
        if (filename !== undefined) {
            query['response-content-disposition'] = `attachment; filename*=UTF-8''${encode(filename)}`;
        }
        return Promise.resolve(this.presign('GET', key, expiresSeconds, query));
    }
    objectUrl(key, query = {}) {
        assertObjectKey(key);
        const url = new URL(this.endpoint.toString());
        const prefix = url.pathname.replace(/\/$/u, '');
        url.pathname = `${prefix}/${encode(this.options.bucket)}/${encodeKey(key)}`;
        url.search = canonicalQuery(query);
        return url;
    }
    signatureKey(date) {
        const dateKey = hmac(`AWS4${this.options.secretAccessKey}`, date);
        const regionKey = hmac(dateKey, this.options.region);
        const serviceKey = hmac(regionKey, 's3');
        return hmac(serviceKey, 'aws4_request');
    }
    requestDate() {
        const iso = this.clock().toISOString().replace(/[:-]|\.\d{3}/gu, '');
        return { amzDate: iso, date: iso.slice(0, 8) };
    }
    async send(request) {
        const body = request.body ?? new Uint8Array();
        const payloadHash = sha256(body);
        const { amzDate, date } = this.requestDate();
        const url = this.objectUrl(request.key, request.query);
        const headers = new Headers(request.headers);
        headers.set('host', url.host);
        headers.set('x-amz-content-sha256', payloadHash);
        headers.set('x-amz-date', amzDate);
        const signedHeaderNames = [...headers.keys()].map((name) => name.toLowerCase()).sort();
        const canonicalHeaders = signedHeaderNames
            .map((name) => `${name}:${headers.get(name)?.trim().replace(/\s+/gu, ' ') ?? ''}\n`)
            .join('');
        const scope = `${date}/${this.options.region}/s3/aws4_request`;
        const canonicalRequest = [
            request.method,
            url.pathname,
            url.search.slice(1),
            canonicalHeaders,
            signedHeaderNames.join(';'),
            payloadHash,
        ].join('\n');
        const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
        const signature = createHmac('sha256', this.signatureKey(date)).update(stringToSign).digest('hex');
        headers.set('authorization', `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`);
        headers.delete('host');
        const requestInit = {
            method: request.method,
            headers,
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            requestInit.body = Buffer.from(body);
        }
        const response = await this.fetcher(url, requestInit);
        if (!response.ok) {
            const errorType = response.headers.get('x-minio-error-code') ?? `HTTP_${response.status}`;
            throw new Error(`S3_REQUEST_FAILED:${errorType}`);
        }
        return response;
    }
    presign(method, key, expiresSeconds, query) {
        assertExpiry(expiresSeconds);
        const { amzDate, date } = this.requestDate();
        const scope = `${date}/${this.options.region}/s3/aws4_request`;
        const signedQuery = {
            ...query,
            'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
            'X-Amz-Credential': `${this.options.accessKeyId}/${scope}`,
            'X-Amz-Date': amzDate,
            'X-Amz-Expires': String(expiresSeconds),
            'X-Amz-SignedHeaders': 'host',
        };
        const url = this.objectUrl(key, signedQuery);
        const canonicalRequest = [
            method,
            url.pathname,
            url.search.slice(1),
            `host:${url.host}\n`,
            'host',
            'UNSIGNED-PAYLOAD',
        ].join('\n');
        const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
        signedQuery['X-Amz-Signature'] = createHmac('sha256', this.signatureKey(date))
            .update(stringToSign)
            .digest('hex');
        return this.objectUrl(key, signedQuery).toString();
    }
}
//# sourceMappingURL=object-storage.js.map