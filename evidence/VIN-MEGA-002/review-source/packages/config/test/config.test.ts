import { describe, expect, it } from 'vitest';
import { loadApiConfig, loadWebConfig, loadWorkerConfig } from '../src/index.js';

describe('typed process configuration', () => {
  it('parses valid API, worker and public web configuration', () => {
    expect(
      loadApiConfig({
        NODE_ENV: 'test',
        VINOPS_LOG_LEVEL: 'silent',
        VINOPS_API_HOST: '127.0.0.1',
        VINOPS_API_PORT: '3000',
      }),
    ).toMatchObject({ VINOPS_API_PORT: 3000 });

    expect(
      loadWorkerConfig({
        NODE_ENV: 'test',
        VINOPS_LOG_LEVEL: 'silent',
        VINOPS_WORKER_NAME: 'worker-test',
      }),
    ).toMatchObject({ VINOPS_WORKER_NAME: 'worker-test' });

    expect(
      loadWebConfig({
        VITE_API_BASE_URL: 'http://127.0.0.1:3000/api/v1',
        VITE_APP_ENV: 'test',
      }),
    ).toMatchObject({ VITE_APP_ENV: 'test' });
  });

  it('fails fast for missing/invalid values and excludes server secrets from public config', () => {
    expect(() =>
      loadApiConfig({
        NODE_ENV: 'test',
        VINOPS_LOG_LEVEL: 'info',
        VINOPS_API_HOST: '127.0.0.1',
      }),
    ).toThrow();
    expect(() =>
      loadWorkerConfig({
        NODE_ENV: 'test',
        VINOPS_LOG_LEVEL: 'invalid',
        VINOPS_WORKER_NAME: 'worker-test',
      }),
    ).toThrow();
    const publicConfig = loadWebConfig({
      VITE_API_BASE_URL: 'http://127.0.0.1:3000/api/v1',
      VITE_APP_ENV: 'test',
      VITE_SECRET: 'must-not-be-used',
    });
    expect(publicConfig).not.toHaveProperty('VITE_SECRET');
    expect(() => loadWebConfig({ VITE_API_BASE_URL: 'not-a-url', VITE_APP_ENV: 'test' })).toThrow();
  });
});
