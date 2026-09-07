import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  initializePushNotifications,
  sendDeviceTokenToApi,
} from '../src/native/push-registration.js';

describe('Capacitor Push Registration (ADR016-CAP-11)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('handles non-native environment gracefully without throwing', async () => {
    const result = await initializePushNotifications({
      apiBaseUrl: 'http://localhost:3000',
      authToken: 'test-token',
    });

    expect(result.registered).toBe(false);
    expect(result.error).toContain('only supported on native devices');
  });

  it('sends device token to the API with authorization header', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { id: 'device-123', status: 'active' },
        }),
    });
    globalThis.fetch = mockFetch;

    const result = await sendDeviceTokenToApi('http://localhost:3000/api/v1', 'auth-123', {
      platform: 'android_fcm',
      deviceToken: 'test-token-val',
      deviceName: 'Pixel 8',
    });

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/users/me/devices',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer auth-123',
        },
      }),
    );
  });
});
