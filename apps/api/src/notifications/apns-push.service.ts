import { Injectable, Logger, Optional } from '@nestjs/common';
import { createSign, randomUUID } from 'node:crypto';
import http2 from 'node:http2';

export interface ApnsConfig {
  teamId?: string | undefined;
  keyId?: string | undefined;
  privateKey?: string | undefined;
  bundleId?: string | undefined;
  production?: boolean | undefined;
}

export interface SendApnsNotificationOptions {
  deviceToken: string;
  title?: string | undefined;
  body?: string | undefined;
  badge?: number | undefined;
  sound?: string | undefined;
  isCritical?: boolean | undefined;
  isSilent?: boolean | undefined;
  data?: Record<string, unknown> | undefined;
}

export interface ApnsSendResult {
  success: boolean;
  apnsId?: string | undefined;
  error?: string | undefined;
  statusCode?: number | undefined;
}

@Injectable()
export class ApnsPushService {
  private readonly logger = new Logger(ApnsPushService.name);
  private cachedToken: { token: string; expiresAt: number } | null = null;

  constructor(@Optional() private readonly config?: ApnsConfig) {}

  private generateAuthToken(): string | null {
    const teamId = this.config?.teamId ?? process.env['APNS_TEAM_ID'];
    const keyId = this.config?.keyId ?? process.env['APNS_KEY_ID'];
    const privateKey = this.config?.privateKey ?? process.env['APNS_PRIVATE_KEY'];

    if (!teamId || !keyId || !privateKey) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60) {
      return this.cachedToken.token;
    }

    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString('base64url');
    const unsignedJwt = `${header}.${payload}`;

    const sign = createSign('SHA256');
    sign.update(unsignedJwt);
    sign.end();
    const signature = sign.sign(privateKey.replace(/\\n/gu, '\n'), 'base64url');
    const token = `${unsignedJwt}.${signature}`;

    this.cachedToken = {
      token,
      expiresAt: now + 3000, // Valid for 50 minutes
    };

    return token;
  }

  async send(options: SendApnsNotificationOptions): Promise<ApnsSendResult> {
    const bundleId = this.config?.bundleId ?? process.env['APNS_BUNDLE_ID'] ?? 'com.vinops.field';
    const isProduction = this.config?.production ?? process.env['NODE_ENV'] === 'production';
    const host = isProduction ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

    const token = this.generateAuthToken();

    // Mock / fallback if no Apple credentials configured
    if (!token) {
      const mockId = `mock-apns-${randomUUID()}`;
      this.logger.log(
        `[MOCK APNS] Push sent to token=${options.deviceToken.slice(0, 12)}... title=${options.title ?? 'none'}`,
      );
      return {
        success: true,
        apnsId: mockId,
        statusCode: 200,
      };
    }

    const payload: Record<string, unknown> = {
      aps: {
        sound: options.sound ?? (options.isCritical ? 'critical.caf' : 'default'),
        ...(options.badge !== undefined ? { badge: options.badge } : {}),
        ...(options.isSilent ? { 'content-available': 1 } : {}),
        ...(options.isCritical
          ? {
              sound: {
                critical: 1,
                name: options.sound ?? 'emergency.wav',
                volume: 1.0,
              },
              'interruption-level': 'critical',
            }
          : {}),
      },
      ...options.data,
    };

    if (!options.isSilent && (options.title || options.body)) {
      (payload['aps'] as Record<string, unknown>)['alert'] = {
        title: options.title,
        body: options.body,
      };
    }

    const jsonPayload = JSON.stringify(payload);

    return new Promise((resolve) => {
      const client = http2.connect(`https://${host}:443`);

      client.on('error', (err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`APNs HTTP/2 connection error: ${errorMsg}`);
        resolve({
          success: false,
          error: errorMsg,
        });
      });

      const priority = options.isCritical ? '10' : options.isSilent ? '5' : '10';
      const pushType = options.isSilent ? 'background' : 'alert';

      const headers: http2.OutgoingHttpHeaders = {
        ':method': 'POST',
        ':path': `/3/device/${options.deviceToken}`,
        authorization: `bearer ${token}`,
        'apns-topic': bundleId,
        'apns-priority': priority,
        'apns-push-type': pushType,
        'content-type': 'application/json',
      };

      const req = client.request(headers);
      let responseBody = '';
      let statusCode = 0;
      let apnsId: string | undefined;

      req.on('response', (resHeaders) => {
        statusCode = Number(resHeaders[':status']);
        const headerId = resHeaders['apns-id'];
        apnsId = typeof headerId === 'string' ? headerId : undefined;
      });

      req.on('data', (chunk: Buffer | string) => {
        responseBody += chunk.toString('utf8');
      });

      req.on('end', () => {
        client.close();
        if (statusCode === 200) {
          resolve({
            success: true,
            apnsId: apnsId || randomUUID(),
            statusCode,
          });
        } else {
          this.logger.warn(`APNs request failed HTTP ${statusCode}: ${responseBody}`);
          resolve({
            success: false,
            statusCode,
            error: responseBody || `HTTP ${statusCode}`,
          });
        }
      });

      req.on('error', (err: unknown) => {
        client.close();
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger.error(`APNs request stream error: ${errorMsg}`);
        resolve({
          success: false,
          error: errorMsg,
        });
      });

      req.write(jsonPayload);
      req.end();
    });
  }
}
