import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { assertObjectKey, ClamAvScanner, S3ObjectStorage } from '../src/index.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('provider-neutral file adapters', () => {
  it('creates short S3-compatible signed URLs without exposing the signing secret', async () => {
    const storage = new S3ObjectStorage({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'vinops-files',
      accessKeyId: 'synthetic-access',
      secretAccessKey: 'synthetic-secret-never-in-the-url',
      clock: () => new Date('2026-08-02T00:00:00Z'),
    });
    const url = await storage.authorizeUploadPart(
      'quarantine/00000000-0000-4000-8000-000000000001/original',
      'synthetic-upload-id',
      1,
      60,
    );
    expect(url).toContain('X-Amz-Expires=60');
    expect(url).toContain('partNumber=1');
    expect(url).not.toContain('synthetic-secret-never-in-the-url');
    expect(() => assertObjectKey('../outside')).toThrowError('OBJECT_KEY_INVALID');
  });

  it('streams bytes through the real clamd INSTREAM protocol boundary', async () => {
    const server = createServer((socket) => {
      socket.once('data', () => socket.end('stream: OK\0'));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Test scanner address missing.');
    const scanner = new ClamAvScanner({
      host: '127.0.0.1',
      port: address.port,
      signatureVersion: 'test',
    });
    await expect(scanner.scan(Buffer.from('safe synthetic content'))).resolves.toEqual({
      outcome: 'clean',
      engine: 'clamav',
      signatureVersion: 'test',
    });
  });
});
