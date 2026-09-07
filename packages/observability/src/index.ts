import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pino, { type DestinationStream, type Logger, type LevelWithSilent } from 'pino';

const context = new AsyncLocalStorage<{ correlationId: string }>();

export const redactedPaths = [
  'authorization',
  'cookie',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'signedUrl',
  'signed_url',
  'objectCredential',
  'object_credential',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
];

export type StructuredLogger = Pick<Logger, 'debug' | 'error' | 'info' | 'trace' | 'warn'>;

export function createLogger(
  name: string,
  level: LevelWithSilent,
  destination?: DestinationStream,
): Logger {
  const options = {
    name,
    level,
    redact: { paths: redactedPaths, censor: '[REDACTED]' },
    base: { service: name },
    mixin: () => {
      const correlationId = context.getStore()?.correlationId;
      return correlationId === undefined ? {} : { correlation_id: correlationId };
    },
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}

export function runWithCorrelation<T>(correlationId: string, task: () => T): T {
  return context.run({ correlationId }, task);
}

export function getCorrelationId(): string | undefined {
  return context.getStore()?.correlationId;
}

export function normalizeCorrelationId(value: string | undefined): string {
  return value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ? value
    : randomUUID();
}
