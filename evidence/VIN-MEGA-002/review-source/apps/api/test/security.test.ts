import { describe, expect, it } from 'vitest';
import {
  hashCredential,
  hashPassword,
  issueAccessToken,
  readCookie,
  refreshCookie,
  verifyAccessToken,
  verifyPassword,
} from '../src/security.js';
import { PlatformError } from '../src/platform-error.js';

function expectPlatformCode(action: () => void, code: string): void {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PlatformError);
  expect((thrown as PlatformError).code).toBe(code);
}

describe('authentication security primitives', () => {
  it('uses parameterized scrypt hashes and verifies without retaining a plaintext password', async () => {
    const encoded = await hashPassword('T3st-only strong password');
    expect(encoded).toMatch(/^scrypt\$16384\$8\$1\$/u);
    await expect(verifyPassword('T3st-only strong password', encoded)).resolves.toBe(true);
    await expect(verifyPassword('not the password', encoded)).resolves.toBe(false);
  });

  it('issues short-lived signed access tokens and rejects tampering', () => {
    const issued = issueAccessToken(
      {
        sub: '00000000-0000-4000-8000-000000000001',
        sid: '00000000-0000-4000-8000-000000000002',
        av: 1,
        azv: 1,
      },
      '01234567890123456789012345678901',
      60,
      new Date('2026-07-30T12:00:00.000Z'),
    );
    expect(
      verifyAccessToken(
        issued.token,
        '01234567890123456789012345678901',
        new Date('2026-07-30T12:00:30.000Z'),
      ).sub,
    ).toBe('00000000-0000-4000-8000-000000000001');
    expectPlatformCode(
      () => verifyAccessToken(`${issued.token}tampered`, '01234567890123456789012345678901'),
      'AUTH_INVALID_CREDENTIALS',
    );
  });

  it('constructs an HttpOnly refresh cookie and never treats it as an application-memory token', () => {
    const cookie = refreshCookie('opaque-token', true, 60);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(readCookie('other=value; vinops_refresh=opaque-token', 'vinops_refresh')).toBe(
      'opaque-token',
    );
    expect(hashCredential('opaque-token')).toHaveLength(64);
  });
});
