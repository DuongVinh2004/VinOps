import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiApplication, enableGracefulShutdown } from '../src/bootstrap.js';
import { PlatformService } from '../src/platform.service.js';

let app: INestApplication | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected JSON object response.');
  }
  return value as Record<string, unknown>;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('API foundation', () => {
  it('serves liveness/readiness and returns a safe correlation identifier', async () => {
    ({ app } = await createApiApplication({
      NODE_ENV: 'test',
      VINOPS_LOG_LEVEL: 'silent',
      VINOPS_API_HOST: '127.0.0.1',
      VINOPS_API_PORT: '3000',
    }));
    await app.init();
    const server = app.getHttpServer() as Server;

    await request(server).get('/health/live').expect(200, { status: 'live' });
    const response = await request(server)
      .get('/health/ready')
      .set('x-correlation-id', 'unsafe-value')
      .expect(200, { status: 'ready' });
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('enables graceful shutdown for SIGINT and SIGTERM', () => {
    const enableShutdownHooks = vi.fn();
    enableGracefulShutdown({ enableShutdownHooks });
    expect(enableShutdownHooks).toHaveBeenCalledWith(['SIGINT', 'SIGTERM']);
  });

  it('returns the versioned platform error contract without exposing security configuration', async () => {
    ({ app } = await createApiApplication({
      NODE_ENV: 'test',
      VINOPS_LOG_LEVEL: 'silent',
      VINOPS_API_HOST: '127.0.0.1',
      VINOPS_API_PORT: '3000',
    }));
    await app.init();
    const server = app.getHttpServer() as Server;

    const response = await request(server)
      .post('/api/v1/auth/sessions')
      .send({ email: 'nobody@example.test', password: 'not-a-real-password' });
    expect(response.status, response.text).toBe(503);
    const payload = asRecord(JSON.parse(response.text) as unknown);
    expect(payload).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      message_key: 'errors.dependencyUnavailable',
      retryable: true,
    });
    expect(payload.correlation_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(JSON.stringify(payload)).not.toContain('VINOPS_AUTH_TOKEN_SECRET');
  });

  it('keeps an unavailable database dependency typed before HTTP error serialization', async () => {
    ({ app } = await createApiApplication({
      NODE_ENV: 'test',
      VINOPS_LOG_LEVEL: 'silent',
      VINOPS_API_HOST: '127.0.0.1',
      VINOPS_API_PORT: '3000',
    }));
    await app.init();

    await expect(
      app
        .get(PlatformService)
        .login(
          { email: 'nobody@example.test', password: 'not-a-real-password' },
          'test',
          '00000000-0000-4000-8000-000000000001',
        ),
    ).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      httpStatus: 503,
    });
  });
});
