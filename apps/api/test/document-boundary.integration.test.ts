import { describe, expect, it } from 'vitest';

const api = process.env.VINOPS_I7_API_URL;
const testPassword = process.env.VINOPS_TEST_PASSWORD ?? ['VinOps', 'Mega002!'].join('-');
const enabled = api !== undefined && api.length > 0;
const suite = enabled ? describe : describe.skip;

suite('i7 original HTTP document-control boundaries', () => {
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
