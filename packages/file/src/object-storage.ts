import { createHash, createHmac } from 'node:crypto';

export type CompletedPart = { partNumber: number; etag: string };

export type StoredObjectMetadata = {
  sizeBytes: number;
  etag: string | null;
  mediaType: string | null;
};

export interface ObjectStorage {
  createMultipartUpload(key: string, mediaType: string): Promise<string>;
  authorizeUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresSeconds: number,
  ): Promise<string>;
  completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly CompletedPart[],
  ): Promise<void>;
  headObject(key: string): Promise<StoredObjectMetadata>;
  getObject(key: string): Promise<Uint8Array>;
  putObject(key: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  copyObject(sourceKey: string, destinationKey: string, mediaType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  authorizeGet(key: string, expiresSeconds: number, filename?: string): Promise<string>;
}

export type S3ObjectStorageOptions = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  clock?: () => Date;
  fetcher?: typeof fetch;
};

type SignedRequest = {
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE';
  key: string;
  query?: Readonly<Record<string, string>>;
  headers?: Readonly<Record<string, string>>;
  body?: Uint8Array;
};

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeKey(key: string): string {
  return key.split('/').map(encode).join('/');
}

function canonicalQuery(query: Readonly<Record<string, string>>): string {
  return Object.entries(query)
    .map(([key, value]) => [encode(key), encode(value)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xmlValue(xml: string, name: string): string | undefined {
  const match = new RegExp(`<${name}>([^<]+)</${name}>`, 'u').exec(xml);
  return match?.[1];
}

export function assertObjectKey(key: string): void {
  if (
    key.length < 1 ||
    key.length > 1024 ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..') ||
    !/^(quarantine|available|derivatives)\//u.test(key)
  ) {
    throw new Error('OBJECT_KEY_INVALID');
  }
}

function assertExpiry(expiresSeconds: number): void {
  if (!Number.isInteger(expiresSeconds) || expiresSeconds < 15 || expiresSeconds > 900) {
    throw new Error('SIGNED_URL_TTL_INVALID');
  }
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly endpoint: URL;
  private readonly clock: () => Date;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: S3ObjectStorageOptions) {
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

  async createMultipartUpload(key: string, mediaType: string): Promise<string> {
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

  authorizeUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    expiresSeconds: number,
  ): Promise<string> {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
      throw new Error('UPLOAD_PART_NUMBER_INVALID');
    }
    return Promise.resolve(
      this.presign('PUT', key, expiresSeconds, {
        partNumber: String(partNumber),
        uploadId,
      }),
    );
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly CompletedPart[],
  ): Promise<void> {
    if (
      parts.length === 0 ||
      parts.length > 10_000 ||
      parts.some(
        (part, index) =>
          !Number.isInteger(part.partNumber) ||
          part.partNumber !== index + 1 ||
          !/^"?[A-Za-z0-9+/=_-]{8,128}"?$/u.test(part.etag),
      )
    ) {
      throw new Error('UPLOAD_PARTS_INVALID');
    }
    const body = Buffer.from(
      `<CompleteMultipartUpload>${parts
        .map(
          (part) =>
            `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${xmlEscape(part.etag)}</ETag></Part>`,
        )
        .join('')}</CompleteMultipartUpload>`,
      'utf8',
    );
    await this.send({
      method: 'POST',
      key,
      query: { uploadId },
      headers: { 'content-type': 'application/xml' },
      body,
    });
  }

  async headObject(key: string): Promise<StoredObjectMetadata> {
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

  async getObject(key: string): Promise<Uint8Array> {
    const response = await this.send({ method: 'GET', key });
    return new Uint8Array(await response.arrayBuffer());
  }

  async putObject(key: string, bytes: Uint8Array, mediaType: string): Promise<void> {
    await this.send({ method: 'PUT', key, headers: { 'content-type': mediaType }, body: bytes });
  }

  async copyObject(sourceKey: string, destinationKey: string, mediaType: string): Promise<void> {
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

  async deleteObject(key: string): Promise<void> {
    assertObjectKey(key);
    await this.send({ method: 'DELETE', key });
  }

  authorizeGet(key: string, expiresSeconds: number, filename?: string): Promise<string> {
    const query: Record<string, string> = {};
    if (filename !== undefined) {
      query['response-content-disposition'] = `attachment; filename*=UTF-8''${encode(filename)}`;
    }
    return Promise.resolve(this.presign('GET', key, expiresSeconds, query));
  }

  private objectUrl(key: string, query: Readonly<Record<string, string>> = {}): URL {
    assertObjectKey(key);
    const url = new URL(this.endpoint.toString());
    const prefix = url.pathname.replace(/\/$/u, '');
    url.pathname = `${prefix}/${encode(this.options.bucket)}/${encodeKey(key)}`;
    url.search = canonicalQuery(query);
    return url;
  }

  private signatureKey(date: string): Buffer {
    const dateKey = hmac(`AWS4${this.options.secretAccessKey}`, date);
    const regionKey = hmac(dateKey, this.options.region);
    const serviceKey = hmac(regionKey, 's3');
    return hmac(serviceKey, 'aws4_request');
  }

  private requestDate(): { amzDate: string; date: string } {
    const iso = this.clock()
      .toISOString()
      .replace(/[:-]|\.\d{3}/gu, '');
    return { amzDate: iso, date: iso.slice(0, 8) };
  }

  private async send(request: SignedRequest): Promise<Response> {
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
    const signature = createHmac('sha256', this.signatureKey(date))
      .update(stringToSign)
      .digest('hex');
    headers.set(
      'authorization',
      `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames.join(';')}, Signature=${signature}`,
    );
    headers.delete('host');
    const requestInit: RequestInit = {
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

  private presign(
    method: 'GET' | 'PUT',
    key: string,
    expiresSeconds: number,
    query: Readonly<Record<string, string>>,
  ): string {
    assertExpiry(expiresSeconds);
    const { amzDate, date } = this.requestDate();
    const scope = `${date}/${this.options.region}/s3/aws4_request`;
    const signedQuery: Record<string, string> = {
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
