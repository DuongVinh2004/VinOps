import { Injectable, Logger, Optional } from '@nestjs/common';
import { createSign, randomUUID } from 'node:crypto';
import type { VinopsDatabase } from '@vinops/database';

export interface FcmConfig {
  projectId?: string | undefined;
  clientEmail?: string | undefined;
  privateKey?: string | undefined;
  dailyQuota?: number | undefined;
}

export interface SendPushNotificationOptions {
  deviceToken: string;
  title?: string | undefined;
  body?: string | undefined;
  data?: Record<string, string> | undefined;
  priority?: 'normal' | 'high' | undefined;
  isSilent?: boolean | undefined;
  userId?: string | undefined;
  organizationId?: string | undefined;
  projectId?: string | undefined;
}

export interface FcmSendResult {
  success: boolean;
  messageId?: string | undefined;
  error?: string | undefined;
  tokenInvalidated?: boolean | undefined;
}

@Injectable()
export class FcmPushService {
  private readonly logger = new Logger(FcmPushService.name);
  private cachedAccessToken: { token: string; expiresAt: number } | null = null;
  private dailyCounter = 0;
  private lastCounterResetDay = new Date().getUTCDate();
  private readonly dailyQuota: number;

  constructor(
    @Optional() private readonly database?: VinopsDatabase,
    @Optional() private readonly config?: FcmConfig,
  ) {
    this.dailyQuota = config?.dailyQuota ?? 500_000;
  }

  private checkAndIncrementQuota(): boolean {
    const today = new Date().getUTCDate();
    if (today !== this.lastCounterResetDay) {
      this.dailyCounter = 0;
      this.lastCounterResetDay = today;
    }

    if (this.dailyCounter >= this.dailyQuota) {
      this.logger.error(
        `FCM daily rate limit quota reached: ${this.dailyCounter}/${this.dailyQuota}`,
      );
      return false;
    }

    this.dailyCounter += 1;
    return true;
  }

  getDailySentCount(): number {
    return this.dailyCounter;
  }

  async getOAuth2AccessToken(): Promise<string | null> {
    const email = this.config?.clientEmail ?? process.env['FCM_CLIENT_EMAIL'];
    const key = this.config?.privateKey ?? process.env['FCM_PRIVATE_KEY'];

    if (!email || !key) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (this.cachedAccessToken && this.cachedAccessToken.expiresAt > now + 60) {
      return this.cachedAccessToken.token;
    }

    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const claim = Buffer.from(
      JSON.stringify({
        iss: email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now,
      }),
    ).toString('base64url');

    const unsignedJwt = `${header}.${claim}`;
    const sign = createSign('RSA-SHA256');
    sign.update(unsignedJwt);
    sign.end();
    const signature = sign.sign(key.replace(/\\n/gu, '\n'), 'base64url');
    const assertion = `${unsignedJwt}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to obtain Google OAuth2 token: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedAccessToken = {
      token: data.access_token,
      expiresAt: now + data.expires_in,
    };

    return data.access_token;
  }

  async send(options: SendPushNotificationOptions): Promise<FcmSendResult> {
    if (!this.checkAndIncrementQuota()) {
      return {
        success: false,
        error: 'FCM_DAILY_QUOTA_EXCEEDED',
      };
    }

    const projectId = this.config?.projectId ?? process.env['FCM_PROJECT_ID'];

    // In test/mock environment without external credentials
    if (!projectId) {
      const mockId = `projects/vinops-mock/messages/mock-fcm-${randomUUID()}`;
      this.logger.log(
        `[MOCK FCM] Sent push to deviceToken=${options.deviceToken.slice(0, 12)}... title=${options.title ?? 'none'}`,
      );
      return {
        success: true,
        messageId: mockId,
      };
    }

    try {
      const accessToken = await this.getOAuth2AccessToken();
      if (!accessToken) {
        // Fallback to simulated delivery if no key provided
        return {
          success: true,
          messageId: `projects/${projectId}/messages/simulated-${randomUUID()}`,
        };
      }

      const fcmPayload: Record<string, unknown> = {
        message: {
          token: options.deviceToken,
          data: options.data ?? {},
          android: {
            priority: options.priority === 'high' ? 'HIGH' : 'NORMAL',
            notification: options.isSilent
              ? undefined
              : {
                  channel_id: 'vinops_critical',
                  sound: 'default',
                },
          },
          apns: {
            headers: {
              'apns-priority': options.isSilent ? '5' : '10',
            },
            payload: {
              aps: {
                sound: options.isSilent ? undefined : 'default',
                'content-available': options.isSilent ? 1 : 0,
              },
            },
          },
        },
      };

      if (!options.isSilent && (options.title || options.body)) {
        (fcmPayload['message'] as Record<string, unknown>)['notification'] = {
          title: options.title,
          body: options.body,
        };
      }

      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(fcmPayload),
        },
      );

      if (response.ok) {
        const resBody = (await response.json()) as { name?: string };
        return {
          success: true,
          messageId: resBody.name,
        };
      }

      const errorText = await response.text();
      let isTokenExpired = false;

      // Check if token expired or unregistered
      if (
        response.status === 404 ||
        errorText.includes('UNREGISTERED') ||
        errorText.includes('INVALID_ARGUMENT')
      ) {
        isTokenExpired = true;
        await this.handleExpiredDeviceToken(options.deviceToken);
      }

      this.logger.warn(`FCM send failed HTTP ${response.status}: ${errorText}`);

      return {
        success: false,
        error: errorText,
        tokenInvalidated: isTokenExpired,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`FCM send unexpected error: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }

  private async handleExpiredDeviceToken(deviceToken: string): Promise<void> {
    if (!this.database) {
      return;
    }

    try {
      await this.database.withTransaction(
        {
          actorUserId: '00000000-0000-0000-0000-000000000000',
          correlationId: 'fcm:revoke-expired',
        },
        async (tx) => {
          await tx.query(
            `UPDATE vinops.user_device_tokens
                SET status = 'expired', updated_at = now()
              WHERE device_token = $1`,
            [deviceToken],
          );
        },
      );
      this.logger.log(`Marked expired device token in database: ${deviceToken.slice(0, 12)}...`);
    } catch (err) {
      this.logger.error(`Failed to mark expired device token: ${String(err)}`);
    }
  }
}
