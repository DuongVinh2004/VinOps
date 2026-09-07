import { z } from 'zod';

export interface RedisConfig {
  hosts: string[];
  password?: string | undefined;
  tls: boolean;
  keyPrefix: string;
  retryStrategy?: ((times: number) => number) | undefined;
}

const booleanEnv = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

export const redisEnvSchema = z.object({
  REDIS_HOSTS: z.string().default('127.0.0.1:6379'),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: booleanEnv,
  REDIS_KEY_PREFIX: z.string().default('vinops:'),
});

export function calculateRedisRetryDelay(
  times: number,
  baseMs = 1000,
  maxMs = 30000,
  randomFn = Math.random,
): number {
  if (times <= 0) {
    return baseMs;
  }
  const exponential = Math.min(baseMs * Math.pow(2, times - 1), maxMs);
  const jitter = Math.floor(randomFn() * (exponential * 0.2));
  return Math.min(exponential + jitter, maxMs);
}

export function parseRedisHosts(hostsString: string): string[] {
  return hostsString
    .split(',')
    .map((h) => h.trim())
    .filter((h) => h.length > 0);
}

export function loadRedisConfig(environment: NodeJS.ProcessEnv = process.env): RedisConfig {
  const parsed = redisEnvSchema.parse(environment);
  const hosts = parseRedisHosts(parsed.REDIS_HOSTS);

  const config: RedisConfig = {
    hosts: hosts.length > 0 ? hosts : ['127.0.0.1:6379'],
    tls: parsed.REDIS_TLS,
    keyPrefix: parsed.REDIS_KEY_PREFIX,
    retryStrategy: (times: number) => calculateRedisRetryDelay(times),
    ...(parsed.REDIS_PASSWORD && parsed.REDIS_PASSWORD.length > 0
      ? { password: parsed.REDIS_PASSWORD }
      : {}),
  };

  return config;
}
