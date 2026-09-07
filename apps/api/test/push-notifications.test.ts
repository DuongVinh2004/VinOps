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
  });
});
