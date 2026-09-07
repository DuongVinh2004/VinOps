import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { PlatformError } from './platform-error.js';

const passwordAlgorithm = 'scrypt';
const scryptCost = 16_384;
const scryptBlockSize = 8;
const scryptParallelization = 1;
const derivedKeyLength = 64;

export type AccessTokenClaims = {
  sub: string;
  sid: string;
  av: number;
  azv: number;
  iat: number;
  exp: number;
  jti: string;
};

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      derivedKeyLength,
      { N: scryptCost, r: scryptBlockSize, p: scryptParallelization, maxmem: 32 * 1024 * 1024 },
      (error, key) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new PlatformError('PASSWORD_POLICY_FAILED', 'errors.passwordPolicyFailed', 422, false);
  }
  const salt = randomBytes(16);
  const derivedKey = await derivePasswordKey(password, salt);
  return [
    passwordAlgorithm,
    String(scryptCost),
    String(scryptBlockSize),
    String(scryptParallelization),
    salt.toString('base64url'),
    derivedKey.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, saltValue, expectedValue, ...rest] =
    encoded.split('$');
  if (
    rest.length !== 0 ||
    algorithm !== passwordAlgorithm ||
    cost !== String(scryptCost) ||
    blockSize !== String(scryptBlockSize) ||
    parallelization !== String(scryptParallelization) ||
    saltValue === undefined ||
    expectedValue === undefined
  ) {
    return false;
  }
  const salt = Buffer.from(saltValue, 'base64url');
  const expected = Buffer.from(expectedValue, 'base64url');
  if (salt.length !== 16 || expected.length !== derivedKeyLength) {
    return false;
  }
  const actual = await derivePasswordKey(password, salt);
  return timingSafeEqual(actual, expected);
}

function encodeJson(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new PlatformError(
      'AUTH_INVALID_CREDENTIALS',
      'errors.authInvalidCredentials',
      401,
      false,
    );
  }
}

function isClaims(value: unknown): value is AccessTokenClaims {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === 'string' &&
    typeof candidate.sid === 'string' &&
    typeof candidate.av === 'number' &&
    typeof candidate.azv === 'number' &&
    typeof candidate.iat === 'number' &&
    typeof candidate.exp === 'number' &&
    typeof candidate.jti === 'string'
  );
}

function signature(input: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(input, 'utf8').digest();
}

export function issueAccessToken(
  claims: Omit<AccessTokenClaims, 'iat' | 'exp' | 'jti'>,
  secret: string,
  ttlSeconds: number,
  now = new Date(),
): { token: string; expiresAt: Date } {
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const fullClaims: AccessTokenClaims = {
    ...claims,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    jti: randomBytes(16).toString('base64url'),
  };
  const encodedHeader = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const encodedPayload = encodeJson(fullClaims);
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  return {
    token: `${unsigned}.${signature(unsigned, secret).toString('base64url')}`,
    expiresAt: new Date(fullClaims.exp * 1_000),
  };
}

export function verifyAccessToken(
  token: string,
  secret: string,
  now = new Date(),
): AccessTokenClaims {
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    throw new PlatformError(
      'AUTH_INVALID_CREDENTIALS',
      'errors.authInvalidCredentials',
      401,
      false,
    );
  }
  const [encodedHeader, encodedPayload, encodedSignature] = segments as [string, string, string];
  const header = decodeJson(encodedHeader);
  const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
  const expectedSignature = signature(`${encodedHeader}.${encodedPayload}`, secret);
  if (
    header === null ||
    typeof header !== 'object' ||
    (header as Record<string, unknown>).alg !== 'HS256' ||
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new PlatformError(
      'AUTH_INVALID_CREDENTIALS',
      'errors.authInvalidCredentials',
      401,
      false,
    );
  }
  const claims = decodeJson(encodedPayload);
  if (!isClaims(claims) || claims.exp <= Math.floor(now.getTime() / 1_000)) {
    throw new PlatformError('AUTH_SESSION_REVOKED', 'errors.authSessionRevoked', 401, false);
  }
  return claims;
}

export function createOpaqueCredential(): string {
  return randomBytes(32).toString('base64url');
}

export function hashCredential(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function equalCredentialHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  for (const item of header.split(';')) {
    const [cookieName, ...rest] = item.trim().split('=');
    if (cookieName === name) {
      return rest.join('=');
    }
  }
  return undefined;
}

export function refreshCookie(value: string, secure: boolean, maxAgeSeconds: number): string {
  return [
    `vinops_refresh=${value}`,
    'Path=/api/v1/auth',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : '',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function expiredRefreshCookie(secure: boolean): string {
  return refreshCookie('', secure, 0);
}
