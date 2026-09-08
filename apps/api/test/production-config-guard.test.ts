import { describe, expect, it } from 'vitest';
import { loadApiConfig } from '@vinops/config';

describe('Production Configuration Security Guards', () => {
  const baseValidProductionEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    VINOPS_LOG_LEVEL: 'info',
    VINOPS_API_HOST: '0.0.0.0',
    VINOPS_API_PORT: '3000',
    VINOPS_DATABASE_URL: 'postgresql://db.internal:5432/vinops',
    VINOPS_AUTH_TOKEN_SECRET: 'super-secret-token-that-is-at-least-32-chars-long',
    VINOPS_ALLOWED_ORIGINS: 'https://app.vinops.vn,https://admin.vinops.vn',
    VINOPS_REFRESH_COOKIE_SECURE: 'true',
    VINOPS_CSC_IS_MOCK: 'false',
  };

  it('accepts valid strict production environment', () => {
    const config = loadApiConfig(baseValidProductionEnv);
    expect(config.NODE_ENV).toBe('production');
    expect(config.VINOPS_REFRESH_COOKIE_SECURE).toBe(true);
    expect(config.VINOPS_CSC_IS_MOCK).toBe(false);
  });

  it('rejects production config with localhost origin', () => {
    const env: NodeJS.ProcessEnv = {
      ...baseValidProductionEnv,
      VINOPS_ALLOWED_ORIGINS: 'http://localhost,http://127.0.0.1',
    };
    expect(() => loadApiConfig(env)).toThrow();
  });

  it('rejects production config with insecure refresh cookie', () => {
    const env: NodeJS.ProcessEnv = {
      ...baseValidProductionEnv,
      VINOPS_REFRESH_COOKIE_SECURE: 'false',
    };
    expect(() => loadApiConfig(env)).toThrow();
  });

  it('rejects production config when missing database url', () => {
    const env: NodeJS.ProcessEnv = {
      ...baseValidProductionEnv,
      VINOPS_DATABASE_URL: undefined,
    };
    expect(() => loadApiConfig(env)).toThrow();
  });

  it('rejects production config when missing auth token secret', () => {
    const env: NodeJS.ProcessEnv = {
      ...baseValidProductionEnv,
      VINOPS_AUTH_TOKEN_SECRET: undefined,
    };
    expect(() => loadApiConfig(env)).toThrow();
  });

  it('rejects production config when mock CSC is enabled', () => {
    const env: NodeJS.ProcessEnv = {
      ...baseValidProductionEnv,
      VINOPS_CSC_IS_MOCK: 'true',
    };
    expect(() => loadApiConfig(env)).toThrow();
  });

  it('rejects production config when mock CSC API URL is provided', () => {
    const env: NodeJS.ProcessEnv = {
      ...baseValidProductionEnv,
      VINOPS_CSC_API_URL: 'https://mock.ca.vinops.local',
    };
    expect(() => loadApiConfig(env)).toThrow();
  });
});
