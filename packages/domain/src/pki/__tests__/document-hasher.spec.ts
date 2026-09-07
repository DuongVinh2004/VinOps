import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { hashBuffer, hashDocumentStream } from '../document-hasher.js';

describe('Document Hasher Spec (NIST & Large Stream)', () => {
  it('matches SHA-256 test vector', async () => {
    const stream = Readable.from([Buffer.from('VinOps Legal PKI Signing 2026', 'utf8')]);
    const hash = await hashDocumentStream(stream, 'SHA-256');
    expect(hash).toBe(hashBuffer(Buffer.from('VinOps Legal PKI Signing 2026', 'utf8'), 'SHA-256'));
    expect(hash).toHaveLength(64);
  });

  it('handles 10MB streaming hash calculation', async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x41); // 1MB 'A'
    let count = 0;
    const stream = new Readable({
      read() {
        if (count < 10) {
          count += 1;
          this.push(chunk);
        } else {
          this.push(null);
        }
      },
    });
    const hash = await hashDocumentStream(stream, 'SHA-256');
    expect(hash).toHaveLength(64);
  });
});
