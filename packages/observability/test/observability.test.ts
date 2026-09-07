import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createLogger,
  getCorrelationId,
  normalizeCorrelationId,
  runWithCorrelation,
} from '../src/index.js';

describe('observability foundation', () => {
  it('redacts credentials and preserves correlation context', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(
        chunk: Buffer | string,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        lines.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        callback();
      },
    });
    const logger = createLogger('test', 'info', sink);
    const correlationId = '123e4567-e89b-42d3-a456-426614174000';

    runWithCorrelation(correlationId, () => {
      expect(getCorrelationId()).toBe(correlationId);
      logger.info({
        authorization: 'Bearer secret',
        cookie: 'vinops_refresh=secret',
        password: 'secret',
        signedUrl: 'https://object.example/signed-secret',
        objectCredential: 'secret',
      });
    });

    const entry = JSON.parse(lines.join('')) as Record<string, unknown>;
    expect(entry).toMatchObject({
      correlation_id: correlationId,
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      password: '[REDACTED]',
      signedUrl: '[REDACTED]',
      objectCredential: '[REDACTED]',
    });
    expect(lines.join('')).not.toContain('signed-secret');
  });

  it('accepts UUIDv4 correlation IDs and replaces unsafe input', () => {
    const valid = '123e4567-e89b-42d3-a456-426614174000';
    expect(normalizeCorrelationId(valid)).toBe(valid);
    expect(normalizeCorrelationId('attacker-controlled-value')).not.toBe(
      'attacker-controlled-value',
    );
  });
});
