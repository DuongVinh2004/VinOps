import { z } from 'zod';

const nodeEnvironment = z.enum(['development', 'test', 'production']);
const logLevel = z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']);
const booleanEnvironment = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const sharedServerSchema = z.object({
  NODE_ENV: nodeEnvironment,
  VINOPS_LOG_LEVEL: logLevel,
});

const apiSchema = sharedServerSchema
  .extend({
    VINOPS_API_HOST: z.string().min(1),
    VINOPS_API_PORT: z.coerce.number().int().min(1).max(65_535),
    VINOPS_DATABASE_URL: z.string().url().optional(),
    VINOPS_AUTH_TOKEN_SECRET: z.string().min(32).optional(),
    VINOPS_ALLOWED_ORIGINS: z.string().default(''),
    VINOPS_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
    VINOPS_REFRESH_IDLE_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    VINOPS_REFRESH_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    VINOPS_AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3_600).default(900),
    VINOPS_AUTH_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
    VINOPS_REFRESH_COOKIE_SECURE: booleanEnvironment,
    VINOPS_S3_ENDPOINT: z.string().url().optional(),
    VINOPS_S3_REGION: z.string().min(1).default('us-east-1'),
    VINOPS_S3_BUCKET: z.string().min(3).max(63).optional(),
    VINOPS_S3_ACCESS_KEY_ID: z.string().min(3).optional(),
    VINOPS_S3_SECRET_ACCESS_KEY: z.string().min(8).optional(),
    VINOPS_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(15).max(300).default(60),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'production') {
      return;
    }
    if (value.VINOPS_DATABASE_URL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['VINOPS_DATABASE_URL'],
        message: 'Required in production.',
      });
    }
    if (value.VINOPS_AUTH_TOKEN_SECRET === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['VINOPS_AUTH_TOKEN_SECRET'],
        message: 'Required in production.',
      });
    }
    const origins = value.VINOPS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (
      origins.length === 0 ||
      origins.some((origin) => origin === 'null' || /^https?:\/\/localhost(?::\d+)?$/u.test(origin))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['VINOPS_ALLOWED_ORIGINS'],
        message: 'Production requires explicit non-localhost origins.',
      });
    }
    if (!value.VINOPS_REFRESH_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['VINOPS_REFRESH_COOKIE_SECURE'],
        message: 'Production refresh cookies must be Secure.',
      });
    }
  });

const workerSchema = sharedServerSchema.extend({
  VINOPS_WORKER_NAME: z.string().min(1).max(120),
  VINOPS_DATABASE_URL: z.string().url().optional(),
  VINOPS_S3_ENDPOINT: z.string().url().optional(),
  VINOPS_S3_REGION: z.string().min(1).default('us-east-1'),
  VINOPS_S3_BUCKET: z.string().min(3).max(63).optional(),
  VINOPS_S3_ACCESS_KEY_ID: z.string().min(3).optional(),
  VINOPS_S3_SECRET_ACCESS_KEY: z.string().min(8).optional(),
  VINOPS_CLAMAV_HOST: z.string().min(1).optional(),
  VINOPS_CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
  VINOPS_OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1000),
  VINOPS_FILE_JOB_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(1000),
});

const webSchema = z.object({
  VITE_API_BASE_URL: z.string().url(),
  VITE_APP_ENV: nodeEnvironment,
});

export type ApiConfig = z.infer<typeof apiSchema>;
export type WorkerConfig = z.infer<typeof workerSchema>;
export type WebConfig = z.infer<typeof webSchema>;

export function parseAllowedOrigins(value: string): readonly string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function loadApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  return apiSchema.parse(environment);
}

export function loadWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  return workerSchema.parse(environment);
}

export function loadWebConfig(environment: Record<string, unknown>): WebConfig {
  return webSchema.parse(environment);
}

export * from './redis.config.js';
