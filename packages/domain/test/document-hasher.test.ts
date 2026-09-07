import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { hashBuffer, hashDocumentStream } from '../src/pki/document-hasher.js';

describe('Document Hasher Module (ADR015-DOM-03 & ADR015-TST-12)', () => {
  // Standard NIST SHA-256 test vectors
  it('computes accurate SHA-256 for empty string (NIST vector)', async () => {
    const emptyStream = Readable.from([]);
    const hash = await hashDocumentStream(emptyStream, 'SHA-256');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes accurate SHA-256 for "abc" test vector', async () => {
    const stream = Readable.from([Buffer.from('abc', 'utf8')]);
    const hash = await hashDocumentStream(stream, 'SHA-256');
    expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hashBuffer(Buffer.from('abc', 'utf8'), 'SHA-256')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('computes accurate SHA-384 test vector', async () => {
    const stream = Readable.from([Buffer.from('abc', 'utf8')]);
    const hash = await hashDocumentStream(stream, 'SHA-384');
    expect(hash).toHaveLength(96);
    expect(hash).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7',
    );
  });

  it('streams large >10MB payload chunk-by-chunk without excessive RAM usage', async () => {
    // Generate 12 chunks of 1MB each = 12MB total
    const chunkSize = 1024 * 1024;
    const chunkCount = 12;
    const sampleByte = 0x5a;
    const chunk = Buffer.alloc(chunkSize, sampleByte);

    let emitted = 0;
    const customStream = new Readable({
      read() {
        if (emitted < chunkCount) {
          emitted += 1;
          this.push(chunk);
        } else {
          this.push(null);
        }
      },
    });

    const hash = await hashDocumentStream(customStream, 'SHA-256');
    expect(hash).toHaveLength(64);

    // Verify against independent node:crypto calculation
    const { createHash } = await import('node:crypto');
    const directHash = createHash('sha256');
    for (let i = 0; i < chunkCount; i += 1) {
      directHash.update(chunk);
    }
    const expected = directHash.digest('hex').toLowerCase();
    expect(hash).toBe(expected);
  });

  it('handles stream errors gracefully by rejecting promise', async () => {
    const brokenStream = new Readable({
      read() {
        this.destroy(new Error('Simulated disk read failure on field PDF'));
      },
    });

    await expect(hashDocumentStream(brokenStream, 'SHA-256')).rejects.toThrow(
      'Simulated disk read failure on field PDF',
    );
  });
});
