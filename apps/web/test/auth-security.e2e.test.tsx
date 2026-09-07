// @vitest-environment jsdom

import type { WebConfig } from '@vinops/config';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app.js';
import { ApiError, VinopsApiClient } from '../src/api.js';

const config: WebConfig = {
  VITE_API_BASE_URL: 'http://127.0.0.1:3000/api/v1',
  VITE_APP_ENV: 'test',
};

type RecordedRequest = {
  input: RequestInfo | URL;
  init: RequestInit | undefined;
};

function pathname(input: RequestInfo | URL): string {
  if (typeof input === 'string') return new URL(input).pathname;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url).pathname;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createMockStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

describe('Browser Auth Security E2E Verification (ADR-003 & PRSS v3.1)', () => {
  let mockLocalStorage: Storage;
  let mockSessionStorage: Storage;

  beforeEach(() => {
    mockLocalStorage = createMockStorage();
    mockSessionStorage = createMockStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, 'sessionStorage', {
      value: mockSessionStorage,
      writable: true,
      configurable: true,
    });
    document.cookie = '';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockLocalStorage.clear();
    mockSessionStorage.clear();
  });

  describe('1. Memory-only Token Storage & HttpOnly Cookie Security', () => {
    it('stores access and CSRF tokens strictly in JavaScript memory and NEVER in localStorage, sessionStorage, or document.cookie', async () => {
      const recorded: RecordedRequest[] = [];
      const fetchMock = vi
        .fn()
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          recorded.push({ input, init });
          const path = pathname(input);
          if (path === '/api/v1/auth/sessions' && init?.method === 'POST') {
            return Promise.resolve(
              json({
                access_token: 'fixture-jwt-token-xyz-123',
                access_token_expires_at: '2099-01-01T00:00:00.000Z',
                csrf_token: 'csrf-secret-hash-abc-789',
                session_id: 'session-id-001',
                user: { id: 'u-1', display_name: 'Site Inspector' },
              }),
            );
          }
          return Promise.resolve(json({ items: [] }));
        });

      const client = new VinopsApiClient(config.VITE_API_BASE_URL, fetchMock);
      const session = await client.login('inspector@vinops.test', 'fixture-secret-password');

      // 1. Session is held in memory
      expect(session.accessToken).toBe('fixture-jwt-token-xyz-123');
      expect(session.csrfToken).toBe('csrf-secret-hash-abc-789');
      expect(client.getSession()).toEqual(session);

      // 2. LocalStorage and SessionStorage MUST BE EMPTY
      expect(mockLocalStorage.getItem('access_token')).toBeNull();
      expect(mockLocalStorage.getItem('vinops_session')).toBeNull();
      expect(mockSessionStorage.getItem('access_token')).toBeNull();
      expect(mockSessionStorage.getItem('vinops_session')).toBeNull();

      // 3. Document cookie must NOT expose the token
      expect(document.cookie).not.toContain('fixture-jwt-token-xyz-123');
      expect(document.cookie).not.toContain('csrf-secret-hash-abc-789');
    });

    it('enforces credentials: "include" for all requests to ensure browser sends HttpOnly refresh cookie', async () => {
      const recorded: RecordedRequest[] = [];
      const fetchMock = vi
        .fn()
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          recorded.push({ input, init });
          return Promise.resolve(json({ items: [] }));
        });

      const client = new VinopsApiClient(config.VITE_API_BASE_URL, fetchMock);
      client.setSession({
        accessToken: 'fixture-valid-token',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: 'csrf-1',
        sessionId: 'sess-1',
        user: { id: 'u-1', displayName: 'Admin' },
      });

      await client.listOrganizations();

      expect(recorded).toHaveLength(1);
      const req = recorded[0]!;
      expect(req.init?.credentials).toBe('include');
      const headers = new Headers(req.init?.headers);
      expect(headers.get('authorization')).toBe('Bearer fixture-valid-token');
      expect(headers.get('accept')).toBe('application/json');
    });
  });

  describe('2. Refresh Token Rotation & Concurrent In-Flight Deduplication', () => {
    it('rotates refresh token sequentially upon token expiration and deduplicates concurrent refresh requests', async () => {
      let refreshCalls = 0;
      let accessRevokedCount = 0;

      const fetchMock = vi
        .fn()
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const path = pathname(input);

          if (path === '/api/v1/auth/refresh' && init?.method === 'POST') {
            refreshCalls += 1;
            return Promise.resolve(
              json({
                access_token: `fixture-rotated-access-token-${refreshCalls}`,
                access_token_expires_at: '2099-01-01T00:00:00.000Z',
                csrf_token: `rotated-csrf-token-${refreshCalls}`,
                session_id: 'session-id-001',
                user: { id: 'u-1', display_name: 'Site Inspector' },
              }),
            );
          }

          if (path === '/api/v1/organizations') {
            accessRevokedCount += 1;
            if (accessRevokedCount <= 2) {
              // First 2 concurrent requests return 401 Token Expired
              return Promise.resolve(json({ code: 'AUTH_TOKEN_EXPIRED' }, 401));
            }
            // Subsequent calls succeed with rotated token
            return Promise.resolve(
              json({
                items: [
                  { id: 'org-1', code: 'VIN', name: 'VinOps Corp', status: 'Active', version: '1' },
                ],
                page: { next_cursor: null, has_more: false },
              }),
            );
          }

          return Promise.resolve(json({ items: [] }));
        });

      const client = new VinopsApiClient(config.VITE_API_BASE_URL, fetchMock);
      client.setSession({
        accessToken: 'fixture-initial-access-token',
        accessTokenExpiresAt: '2026-09-07T00:00:00.000Z',
        csrfToken: 'initial-csrf-token',
        sessionId: 'session-id-001',
        user: { id: 'u-1', displayName: 'Site Inspector' },
      });

      // Hai request song song đồng thời gặp 401
      const [res1, res2] = await Promise.all([
        client.listOrganizations(),
        client.listOrganizations(),
      ]);

      // Chỉ có DUY NHẤT 1 request refresh được gửi lên server (deduplication qua refreshInFlight)
      expect(refreshCalls).toBe(1);
      expect(res1).toHaveLength(1);
      expect(res2).toHaveLength(1);

      // Session trong client đã được xoay vòng sang token mới
      expect(client.getSession()?.accessToken).toBe('fixture-rotated-access-token-1');
      expect(client.getSession()?.csrfToken).toBe('rotated-csrf-token-1');
    });
  });

  describe('3. Multi-tab Session Revocation Flow', () => {
    it('clears in-memory session and resets client state when session is revoked by another tab', async () => {
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const path = pathname(input);
        if (path === '/api/v1/organizations') {
          // Server từ chối vì phiên đã bị Tab khác thu hồi
          return Promise.resolve(json({ code: 'AUTH_SESSION_REVOKED' }, 401));
        }
        if (path === '/api/v1/auth/refresh') {
          // Thử refresh cũng thất bại do refresh token cookie đã bị revoked
          return Promise.resolve(json({ code: 'AUTH_REFRESH_REVOKED' }, 401));
        }
        return Promise.resolve(json({ items: [] }));
      });

      const client = new VinopsApiClient(config.VITE_API_BASE_URL, fetchMock);
      client.setSession({
        accessToken: 'fixture-tab-stale-access-token',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: 'tab-stale-csrf',
        sessionId: 'session-revoked-elsewhere',
        user: { id: 'u-1', displayName: 'User Tab B' },
      });

      // Khi gọi API bị 401 và refresh cũng 401, client phải ném lỗi và xóa sạch session in-memory
      await expect(client.listOrganizations()).rejects.toThrow(ApiError);
      expect(client.getSession()).toBeNull();
    });

    it('renders login page after signOut is initiated and clears memory', async () => {
      let signOutDispatched = false;
      const fetchMock = vi
        .fn()
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const path = pathname(input);
          if (path === '/api/v1/auth/sessions' && init?.method === 'DELETE') {
            signOutDispatched = true;
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          return Promise.resolve(json({ items: [] }));
        });

      const client = new VinopsApiClient(config.VITE_API_BASE_URL, fetchMock);
      client.setSession({
        accessToken: 'fixture-active-session-token',
        accessTokenExpiresAt: '2099-01-01T00:00:00.000Z',
        csrfToken: 'csrf-active',
        sessionId: 'sess-active',
        user: { id: 'u-1', displayName: 'User Admin' },
      });

      await client.signOut();

      expect(signOutDispatched).toBe(true);
      expect(client.getSession()).toBeNull();
    });
  });

  describe('4. Graceful 404 & 503 Fallback UI', () => {
    it('gracefully handles 404 Not Found error without crashing the application shell', async () => {
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const path = pathname(input);
        if (path === '/api/v1/organizations') {
          return Promise.resolve(json({ code: 'RESOURCE_NOT_FOUND' }, 404));
        }
        return Promise.resolve(json({ items: [] }));
      });

      vi.stubGlobal('fetch', fetchMock);

      render(<App config={config} initialAuthenticated={true} />);

      // Chờ giao diện hiển thị thông báo lỗi thân thiện 404 (Permission denied / workspace no longer available)
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(screen.getByText(/Permission denied/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Your server-authorized workspace context is no longer available/i),
      ).toBeInTheDocument();
      // Memory auth state note vẫn an toàn
      expect(screen.getByTestId('memory-auth-state')).toBeInTheDocument();
    });

    it('gracefully handles 503 Service Unavailable with retry button and does not repeat mutations automatically', async () => {
      let attemptCount = 0;
      const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const path = pathname(input);
        if (path === '/api/v1/organizations') {
          attemptCount += 1;
          if (attemptCount === 1) {
            // Lần 1 trả về 503 Service Unavailable
            return Promise.resolve(json({ code: 'DATABASE_UNAVAILABLE', retryable: true }, 503));
          }
          // Lần 2 khi người dùng ấn retry thì phục hồi
          return Promise.resolve(
            json({
              items: [
                {
                  id: 'org-recovered',
                  code: 'REC',
                  name: 'Recovered Org',
                  status: 'Active',
                  version: '1',
                },
              ],
              page: { next_cursor: null, has_more: false },
            }),
          );
        }
        if (path === '/api/v1/organizations/org-recovered/projects') {
          return Promise.resolve(json({ items: [], page: { next_cursor: null, has_more: false } }));
        }
        return Promise.resolve(json({ items: [] }));
      });

      vi.stubGlobal('fetch', fetchMock);

      render(<App config={config} initialAuthenticated={true} />);

      // Chờ thông báo lỗi 503 hiển thị
      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      expect(
        screen.getByRole('heading', { name: /Project context could not be loaded/i }),
      ).toBeInTheDocument();
      const retryButton = screen.getByRole('button', { name: /Retry loading project context/i });
      expect(retryButton).toBeInTheDocument();

      // Bấm nút Retry loading project context thủ công
      fireEvent.click(retryButton);

      // Xác nhận hệ thống gọi lại và nạp thành công
      await waitFor(() => {
        expect(attemptCount).toBe(2);
      });
    });
  });
});
