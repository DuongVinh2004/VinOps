import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ClamAvScanner, S3ObjectStorage } from '../src/index.js';

const s3Endpoint = process.env.VINOPS_TEST_S3_ENDPOINT;
const s3Bucket = process.env.VINOPS_TEST_S3_BUCKET;
const s3AccessKey = process.env.VINOPS_TEST_S3_ACCESS_KEY_ID;
const s3SecretKey = process.env.VINOPS_TEST_S3_SECRET_ACCESS_KEY;
const clamAvHost = process.env.VINOPS_TEST_CLAMAV_HOST;
const clamAvPort = Number(process.env.VINOPS_TEST_CLAMAV_PORT ?? '0');

const describeS3 =
  s3Endpoint === undefined ||
  s3Bucket === undefined ||
  s3AccessKey === undefined ||
  s3SecretKey === undefined
    ? describe.skip
    : describe;
const describeClamAv =
  clamAvHost === undefined || !Number.isInteger(clamAvPort) || clamAvPort < 1
    ? describe.skip
    : describe;

describeS3('S3-compatible object storage runtime', () => {
  it('round-trips a quarantine multipart object, promotes it, and rejects an expired URL', async () => {
    const storage = new S3ObjectStorage({
      endpoint: s3Endpoint as string,
      region: 'us-east-1',
      bucket: s3Bucket as string,
      accessKeyId: s3AccessKey as string,
      secretAccessKey: s3SecretKey as string,
    });
    const id = randomUUID();
    const quarantineKey = `quarantine/${id}/original`;
    const availableKey = `available/${id}/original`;
    const bytes = Buffer.from('%PDF-1.7\n% synthetic VinOps runtime PDF\n%%EOF\n', 'utf8');
    const uploadId = await storage.createMultipartUpload(quarantineKey, 'application/pdf');
    const partUrl = await storage.authorizeUploadPart(quarantineKey, uploadId, 1, 60);
    const partResponse = await fetch(partUrl, { method: 'PUT', body: bytes });
    expect(partResponse.status).toBe(200);
    const etag = partResponse.headers.get('etag');
    expect(etag).not.toBeNull();
    await storage.completeMultipartUpload(quarantineKey, uploadId, [
      { partNumber: 1, etag: etag as string },
    ]);
    await expect(storage.headObject(quarantineKey)).resolves.toMatchObject({
      sizeBytes: bytes.length,
    });
    await expect(storage.getObject(quarantineKey)).resolves.toEqual(new Uint8Array(bytes));
    await storage.copyObject(quarantineKey, availableKey, 'application/pdf');
    const availableUrl = await storage.authorizeGet(availableKey, 60, 'runtime.pdf');
    const availableResponse = await fetch(availableUrl);
    expect(availableResponse.status).toBe(200);
    await expect(availableResponse.arrayBuffer()).resolves.toEqual(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );

    const expiredStorage = new S3ObjectStorage({
      endpoint: s3Endpoint as string,
      region: 'us-east-1',
      bucket: s3Bucket as string,
      accessKeyId: s3AccessKey as string,
      secretAccessKey: s3SecretKey as string,
      clock: () => new Date(Date.now() - 60_000),
    });
    const expiredUrl = await expiredStorage.authorizeGet(availableKey, 15);
    expect((await fetch(expiredUrl)).status).toBe(403);
  });
});

describeClamAv('ClamAV runtime', () => {
  it('scans benign bytes and, when injected at runtime, detects the ephemeral test signature', async () => {
    const scanner = new ClamAvScanner({
      host: clamAvHost as string,
      port: clamAvPort,
      signatureVersion: 'local-runtime',
    });
    await expect(
      scanner.scan(Buffer.from('benign synthetic VinOps content', 'utf8')),
    ).resolves.toMatchObject({
      outcome: 'clean',
      engine: 'clamav',
    });
    const injectedSignature = process.env.VINOPS_MALWARE_TEST_B64;
    if (injectedSignature !== undefined) {
      const result = await scanner.scan(Buffer.from(injectedSignature, 'base64'));
      expect(result.outcome).toBe('infected');
      if (result.outcome === 'infected') expect(result.threatName).toMatch(/Eicar|Test/u);
    }
  });
});
