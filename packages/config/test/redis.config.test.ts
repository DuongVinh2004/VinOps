import { describe, expect, it } from 'vitest';
import { calculateRedisRetryDelay, loadRedisConfig, parseRedisHosts } from '../src/index.js';

describe('Redis Configuration (ADR016-CFG-02)', () => {
  it('parses default Redis configuration when environment is empty', () => {
    const config = loadRedisConfig({});
    expect(config.hosts).toEqual(['127.0.0.1:6379']);
    expect(config.password).toBeUndefined();
    expect(config.tls).toBe(false);
    expect(config.keyPrefix).toBe('vinops:');
  });

  it('parses custom Redis configuration with cluster hosts and TLS', () => {
    const config = loadRedisConfig({
      REDIS_HOSTS: 'redis-1.vinops.local:6379, redis-2.vinops.local:6379',
      REDIS_PASSWORD: 'secret-redis-password',
      REDIS_TLS: 'true',
      REDIS_KEY_PREFIX: 'custom-vinops:',
    });
    expect(config.hosts).toEqual(['redis-1.vinops.local:6379', 'redis-2.vinops.local:6379']);
    expect(config.password).toBe('secret-redis-password');
    expect(config.tls).toBe(true);
    expect(config.keyPrefix).toBe('custom-vinops:');
  });

  it('splits and trims hosts correctly', () => {
    expect(parseRedisHosts('  10.0.0.1:6379, 10.0.0.2:6379 ,  ')).toEqual([
      '10.0.0.1:6379',
      '10.0.0.2:6379',
    ]);
  });

  it('calculates exponential backoff with jitter and respects max delay', () => {
    const mockZeroJitter = () => 0;
    expect(calculateRedisRetryDelay(1, 1000, 30000, mockZeroJitter)).toBe(1000);
    expect(calculateRedisRetryDelay(2, 1000, 30000, mockZeroJitter)).toBe(2000);
    expect(calculateRedisRetryDelay(3, 1000, 30000, mockZeroJitter)).toBe(4000);
    expect(calculateRedisRetryDelay(4, 1000, 30000, mockZeroJitter)).toBe(8000);
    expect(calculateRedisRetryDelay(5, 1000, 30000, mockZeroJitter)).toBe(16000);
    expect(calculateRedisRetryDelay(6, 1000, 30000, mockZeroJitter)).toBe(30000); // capped at 30s
    expect(calculateRedisRetryDelay(10, 1000, 30000, mockZeroJitter)).toBe(30000);

    const mockMaxJitter = () => 0.999;
    // With 20% jitter max: 1000 + floor(0.999 * 200) = 1199
    expect(calculateRedisRetryDelay(1, 1000, 30000, mockMaxJitter)).toBe(1199);
  });
});
