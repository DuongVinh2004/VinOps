import { describe, expect, it } from 'vitest';
import { FcmPushService } from '../src/notifications/fcm-push.service.js';
import { ApnsPushService } from '../src/notifications/apns-push.service.js';

describe('Push Notification Services (ADR016-SVC-06 & SVC-07)', () => {
  describe('FcmPushService', () => {
    it('sends test notification gracefully in mock environment', async () => {
      const service = new FcmPushService();
      const result = await service.send({
        deviceToken: 'fK9L1xYz_mock_device_token_for_vinops_android_testing_123456789',
        title: 'Cảnh báo an toàn hiện trường',
        body: 'Phát hiện sự cố an toàn tại tầng hầm B1',
        priority: 'high',
        data: {
          issueId: 'iss-123',
          severity: 'Critical',
        },
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toMatch(/^projects\/vinops-mock\/messages\/mock-fcm-/);
      expect(service.getDailySentCount()).toBe(1);
    });

    it('enforces 500k/day rate limit quota', async () => {
      const quotaLimitedService = new FcmPushService(undefined, { dailyQuota: 2 });

      const res1 = await quotaLimitedService.send({ deviceToken: 'token-1' });
      expect(res1.success).toBe(true);

      const res2 = await quotaLimitedService.send({ deviceToken: 'token-2' });
      expect(res2.success).toBe(true);

      const res3 = await quotaLimitedService.send({ deviceToken: 'token-3' });
      expect(res3.success).toBe(false);
      expect(res3.error).toBe('FCM_DAILY_QUOTA_EXCEEDED');
    });
  });

  describe('ApnsPushService', () => {
    it('sends test notification gracefully in mock environment', async () => {
      const service = new ApnsPushService();
      const result = await service.send({
        deviceToken: 'mock_apns_device_token_ios_simulator_1234567890abcdef',
        title: 'Yêu cầu nghiệm thu mới',
        body: 'Biên bản nghiệm thu cọc khoan nhồi C-08 sẵn sàng ký',
        sound: 'critical.caf',
        isCritical: true,
        badge: 3,
        data: {
          inspectionId: 'insp-101',
        },
      });

      expect(result.success).toBe(true);
      expect(result.apnsId).toMatch(/^mock-apns-/);
      expect(result.statusCode).toBe(200);
    });

    it('retries on transient errors and halts on client 400 errors', async () => {
      let callCount = 0;
      const service = new ApnsPushService({ retryBaseDelayMs: 1, maxRetries: 3 });
      // Stub executeHttp2Request to simulate transient error then success
      (service as unknown as { executeHttp2Request: unknown }).executeHttp2Request = () => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve({
            success: false,
            statusCode: 503,
            error: 'Service Unavailable',
            deliveryStatus: 'failed',
          });
        }
        return Promise.resolve({
          success: true,
          apnsId: 'apns-retry-success',
          statusCode: 200,
          deliveryStatus: 'provider_accepted',
        });
      };
      // Stub generateAuthToken to return valid token
      (service as unknown as { generateAuthToken: unknown }).generateAuthToken = () => 'test-jwt';

      const result = await service.send({ deviceToken: 'tok-retry-test' });
      expect(result.success).toBe(true);
      expect(callCount).toBe(3);

      // Verify client error 400 is not retried
      let clientErrorCalls = 0;
      (service as unknown as { executeHttp2Request: unknown }).executeHttp2Request = () => {
        clientErrorCalls++;
        return Promise.resolve({
          success: false,
          statusCode: 400,
          error: 'BadDeviceToken',
          deliveryStatus: 'failed',
        });
      };
      const badResult = await service.send({ deviceToken: 'tok-bad' });
      expect(badResult.success).toBe(false);
      expect(clientErrorCalls).toBe(1); // No retry on 400
    });
  });

  describe('FcmPushService Retry Behavior', () => {
    it('retries on transient 500/503/429 errors up to maxRetries', async () => {
      let fetchCount = 0;
      const service = new FcmPushService(undefined, {
        projectId: 'test-project',
        clientEmail: 'test@service.com',
        privateKey: 'key',
        retryBaseDelayMs: 1,
        maxRetries: 3,
      });

      (service as unknown as { getOAuth2AccessToken: unknown }).getOAuth2AccessToken = () =>
        Promise.resolve('mock-token');

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = () => {
          fetchCount++;
          if (fetchCount < 3) {
            return Promise.resolve(
              new Response('Transient Server Error', {
                status: 500,
                statusText: 'Internal Server Error',
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ name: 'projects/test-project/messages/msg-123' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        };

        const result = await service.send({ deviceToken: 'valid-token', title: 'Retry Test' });
        expect(result.success).toBe(true);
        expect(result.messageId).toBe('projects/test-project/messages/msg-123');
        expect(fetchCount).toBe(3);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('does not retry client 400 or invalid token errors', async () => {
      let fetchCount = 0;
      const service = new FcmPushService(undefined, {
        projectId: 'test-project',
        clientEmail: 'test@service.com',
        privateKey: 'key',
        retryBaseDelayMs: 1,
        maxRetries: 3,
      });

      (service as unknown as { getOAuth2AccessToken: unknown }).getOAuth2AccessToken = () =>
        Promise.resolve('mock-token');

      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = () => {
          fetchCount++;
          return Promise.resolve(
            new Response('INVALID_ARGUMENT: Bad token', {
              status: 400,
              statusText: 'Bad Request',
            }),
          );
        };

        const result = await service.send({ deviceToken: 'invalid-token' });
        expect(result.success).toBe(false);
        expect(fetchCount).toBe(1); // Strictly no retry
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
