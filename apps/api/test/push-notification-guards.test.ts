import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApnsPushService } from '../src/notifications/apns-push.service.js';
import { FcmPushService } from '../src/notifications/fcm-push.service.js';

describe('Push Notifications Security & Production Guards', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  describe('APNs fail-closed guard', () => {
    it('returns simulated delivery in test mode when credentials are missing', async () => {
      const apns = new ApnsPushService();
      const result = await apns.send({
        deviceToken: 'test-device-token-123456789012',
        title: 'Test Notification',
        body: 'Test Body',
      });
      expect(result.success).toBe(true);
      expect(result.deliveryStatus).toBe('simulated');
      expect(result.apnsId).toMatch(/^mock-apns-/);
    });

    it('strictly fails with success=false in production when credentials are missing', async () => {
      process.env['NODE_ENV'] = 'production';
      const apns = new ApnsPushService();
      const result = await apns.send({
        deviceToken: 'test-device-token-123456789012',
        title: 'Production Notification',
        body: 'Production Body',
      });
      expect(result.success).toBe(false);
      expect(result.deliveryStatus).toBe('failed');
      expect(result.error).toBe('APNS_CREDENTIALS_MISSING');
      expect(result.statusCode).toBe(500);
    });
  });

  describe('FCM fail-closed guard', () => {
    it('returns simulated delivery in test mode when FCM_PROJECT_ID is missing', async () => {
      const fcm = new FcmPushService();
      const result = await fcm.send({
        deviceToken: 'test-fcm-token-123456789012',
        title: 'Test FCM Notification',
      });
      expect(result.success).toBe(true);
      expect(result.deliveryStatus).toBe('simulated');
      expect(result.messageId).toContain('mock-fcm-');
    });

    it('strictly fails with success=false in production when FCM_PROJECT_ID is missing', async () => {
      process.env['NODE_ENV'] = 'production';
      const fcm = new FcmPushService();
      const result = await fcm.send({
        deviceToken: 'test-fcm-token-123456789012',
        title: 'Production FCM Notification',
      });
      expect(result.success).toBe(false);
      expect(result.deliveryStatus).toBe('failed');
      expect(result.error).toBe('FCM_PROJECT_ID_MISSING');
    });
  });
});
