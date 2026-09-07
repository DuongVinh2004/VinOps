import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

export type HashAlgorithm = 'SHA-256' | 'SHA-384';

/**
 * Computes hash digest of a readable stream using Node.js streaming crypto.
 * Does not buffer entire stream into RAM.
 * Returns lowercase hex string (64 characters for SHA-256, 96 characters for SHA-384).
 */
export async function hashDocumentStream(
  readable: NodeJS.ReadableStream | Readable,
  algorithm: HashAlgorithm = 'SHA-256',
): Promise<string> {
  const nodeAlgo = algorithm === 'SHA-384' ? 'sha384' : 'sha256';
  const hasher = createHash(nodeAlgo);

  return new Promise<string>((resolve, reject) => {
    readable.on('data', (chunk: Buffer | Uint8Array | string) => {
      hasher.update(chunk);
    });

    readable.on('end', () => {
      resolve(hasher.digest('hex').toLowerCase());
    });

    readable.on('error', (err: Error) => {
      reject(err);
    });
  });
}

/**
 * Utility helper to compute hash digest of in-memory Buffer or Uint8Array.
 */
export function hashBuffer(
  buffer: Buffer | Uint8Array,
  algorithm: HashAlgorithm = 'SHA-256',
): string {
  const nodeAlgo = algorithm === 'SHA-384' ? 'sha384' : 'sha256';
  return createHash(nodeAlgo).update(buffer).digest('hex').toLowerCase();
}
