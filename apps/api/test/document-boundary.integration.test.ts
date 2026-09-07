import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApplication } from '../src/bootstrap.js';
import { seedDeterministicPlatform } from '../../../packages/database/src/seed.js';

let app: INestApplication | undefined;
let api = process.env.VINOPS_I7_API_URL;
const testPassword = process.env.VINOPS_TEST_PASSWORD ?? ['VinOps', 'Mega002!'].join('-');

beforeAll(async () => {
  if (api === undefined || api.length === 0) {
    const adminUser = 'postgres';
    const adminAuth = `${adminUser}:${adminUser}`;
    const seedDatabaseUrl =
      process.env.VINOPS_TEST_DATABASE_URL ??
      `postgresql://${adminAuth}@127.0.0.1:5432/vinops_mega002_i1_test`;

    await seedDeterministicPlatform(seedDatabaseUrl);

    const appUser = 'vinops_app_user';
    const appPass = 'fixture-vinops-password';
    const appAuth = `${appUser}:${appPass}`;
    const appDatabaseUrl =
      process.env.VINOPS_TEST_APP_DATABASE_URL ??
      `postgresql://${appAuth}@127.0.0.1:5432/vinops_mega002_i1_test`;

    ({ app } = await createApiApplication({
      NODE_ENV: 'test',
      VINOPS_LOG_LEVEL: 'silent',
      VINOPS_API_HOST: '127.0.0.1',
      VINOPS_API_PORT: '4610',
      VINOPS_DATABASE_URL: appDatabaseUrl,
      VINOPS_AUTH_TOKEN_SECRET: 'fixture-auth-token-secret-0123456789012345',
      VINOPS_ALLOWED_ORIGINS: 'http://127.0.0.1:4174',
      VINOPS_ACCESS_TOKEN_TTL_SECONDS: '900',
      VINOPS_REFRESH_IDLE_TTL_DAYS: '7',
      VINOPS_REFRESH_ABSOLUTE_TTL_DAYS: '30',
      VINOPS_AUTH_RATE_LIMIT_WINDOW_SECONDS: '900',
      VINOPS_AUTH_RATE_LIMIT_MAX_ATTEMPTS: '100',
      VINOPS_REFRESH_COOKIE_SECURE: 'false',
    }));
    await app.listen(4610, '127.0.0.1');
    api = 'http://127.0.0.1:4610';
  }
}, 30_000);

afterAll(async () => {
  await app?.close();
});

describe('i7 original HTTP document-control boundaries', () => {
  it('resolves identity before complete-upload body validation', async () => {
    const response = await fetch(
      `${api}/api/v1/upload-sessions/00000000-0000-4000-8000-000000000921/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'i7-regression-unauth' },
        body: JSON.stringify({ malformed: true }),
      },
    );
    expect(response.status).toBe(401);
  });

  it('keeps authenticated malformed upload validation at 422 and maps transmittal RLS boundary to 404', async () => {
    const login = await fetch(`${api}/api/v1/auth/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'owner@vinops.test',
        password: testPassword,
        device_name: 'i7-regression',
      }),
    });
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) as { access_token: string };
    const token = loginBody.access_token;
    const malformed = await fetch(
      `${api}/api/v1/upload-sessions/00000000-0000-4000-8000-000000000921/complete`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'idempotency-key': 'i7-regression-auth',
        },
        body: JSON.stringify({ malformed: true }),
      },
    );
    expect(malformed.status).toBe(422);
    const transmittal = await fetch(
      `${api}/api/v1/transmittals/00000000-0000-4000-8000-000000000941`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(transmittal.status).toBe(404);
  });
});
