import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { VinopsDatabase } from '@vinops/database';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';

export interface RegisterDeviceDto {
  platform: 'android_fcm' | 'ios_apns' | 'web_push';
  deviceToken: string;
  deviceName?: string | undefined;
  deviceModel?: string | undefined;
  appVersion?: string | undefined;
  osVersion?: string | undefined;
}

export interface UserDeviceRecord {
  id: string;
  platform: string;
  deviceName: string;
  deviceModel: string;
  appVersion: string;
  osVersion: string;
  status: string;
  lastActiveAt: string;
  createdAt: string;
}

export interface NotificationPreferenceItem {
  eventCategory:
    'field_issue' | 'rfi' | 'submittal' | 'inspection' | 'daily_log' | 'document' | 'system';
  channelWeb: boolean;
  channelPush: boolean;
  channelEmail: boolean;
  quietHoursStart?: string | null | undefined;
  quietHoursEnd?: string | null | undefined;
}

@Injectable()
export class NotificationService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(
    @Inject(API_CONFIG) @Optional() private readonly config?: ApiRuntimeConfig,
    @Optional() database?: VinopsDatabase,
  ) {
    if (database) {
      this.database = database;
    } else if (config?.VINOPS_DATABASE_URL) {
      this.database = new VinopsDatabase({
        connectionString: config.VINOPS_DATABASE_URL,
        applicationName: 'vinops-notifications-api',
        runtimeRole: 'vinops_app',
      });
    } else {
      this.database = undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  private requireDatabase(): VinopsDatabase {
    if (this.database === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.database;
  }

  async resolveUserOrganization(userId: string, correlationId: string): Promise<string> {
    return this.requireDatabase().withTransaction(
      { actorUserId: userId, correlationId },
      async (tx) => {
        const rows = await tx.query<{ organization_id: string }>(
          `SELECT organization_id
           FROM vinops.organization_members
          WHERE user_id = $1::uuid
            AND status = 'Active'
          LIMIT 1`,
          [userId],
        );
        const row = rows[0];
        return row ? row.organization_id : '00000000-0000-0000-0000-000000000000';
      },
    );
  }

  async registerDevice(
    userId: string,
    organizationId: string,
    dto: RegisterDeviceDto,
    correlationId: string,
  ): Promise<UserDeviceRecord> {
    return this.requireDatabase().withTransaction(
      { actorUserId: userId, correlationId },
      async (tx) => {
        const id = randomUUID();
        const rows = await tx.query<UserDeviceRecord>(
          `INSERT INTO vinops.user_device_tokens (
           id, organization_id, user_id, platform, device_token,
           device_name, device_model, app_version, os_version,
           status, last_active_at, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', now(), now(), now())
         ON CONFLICT (user_id, platform, device_token)
         DO UPDATE SET
           device_name = EXCLUDED.device_name,
           device_model = EXCLUDED.device_model,
           app_version = EXCLUDED.app_version,
           os_version = EXCLUDED.os_version,
           status = 'active',
           last_active_at = now(),
           updated_at = now()
         RETURNING
           id, platform, device_name AS "deviceName", device_model AS "deviceModel",
           app_version AS "appVersion", os_version AS "osVersion", status,
           last_active_at AS "lastActiveAt", created_at AS "createdAt"`,
          [
            id,
            organizationId,
            userId,
            dto.platform,
            dto.deviceToken,
            dto.deviceName ?? '',
            dto.deviceModel ?? '',
            dto.appVersion ?? '',
            dto.osVersion ?? '',
          ],
        );

        return rows[0]!;
      },
    );
  }

  async revokeDevice(
    userId: string,
    deviceId: string,
    correlationId: string,
  ): Promise<{ id: string; status: string; revokedAt: string }> {
    return this.requireDatabase().withTransaction(
      { actorUserId: userId, correlationId },
      async (tx) => {
        const rows = await tx.query<{ id: string; status: string; updated_at: string }>(
          `UPDATE vinops.user_device_tokens
            SET status = 'revoked', updated_at = now()
          WHERE id = $1::uuid
            AND user_id = $2::uuid
          RETURNING id, status, updated_at`,
          [deviceId, userId],
        );

        const record = rows[0];
        return {
          id: record ? record.id : deviceId,
          status: 'revoked',
          revokedAt: record ? record.updated_at : new Date().toISOString(),
        };
      },
    );
  }

  async listUserDevices(
    userId: string,
    correlationId: string,
  ): Promise<readonly UserDeviceRecord[]> {
    return this.requireDatabase().withTransaction(
      { actorUserId: userId, correlationId },
      async (tx) => {
        return tx.query<UserDeviceRecord>(
          `SELECT id, platform, device_name AS "deviceName", device_model AS "deviceModel",
                app_version AS "appVersion", os_version AS "osVersion", status,
                last_active_at AS "lastActiveAt", created_at AS "createdAt"
           FROM vinops.user_device_tokens
          WHERE user_id = $1::uuid
            AND status = 'active'
          ORDER BY last_active_at DESC`,
          [userId],
        );
      },
    );
  }

  async getNotificationPreferences(
    userId: string,
    projectId: string,
    correlationId: string,
  ): Promise<readonly NotificationPreferenceItem[]> {
    return this.requireDatabase().withTransaction(
      { actorUserId: userId, correlationId },
      async (tx) => {
        return tx.query<NotificationPreferenceItem>(
          `SELECT event_category AS "eventCategory",
                channel_web AS "channelWeb",
                channel_push AS "channelPush",
                channel_email AS "channelEmail",
                quiet_hours_start::text AS "quietHoursStart",
                quiet_hours_end::text AS "quietHoursEnd"
           FROM vinops.notification_preferences
          WHERE project_id = $1::uuid
            AND user_id = $2::uuid`,
          [projectId, userId],
        );
      },
    );
  }

  async updateNotificationPreferences(
    userId: string,
    organizationId: string,
    projectId: string,
    preferences: NotificationPreferenceItem[],
    correlationId: string,
  ): Promise<{ projectId: string; updatedCount: number; updatedAt: string }> {
    return this.requireDatabase().withTransaction(
      { actorUserId: userId, correlationId },
      async (tx) => {
        let count = 0;
        for (const pref of preferences) {
          const id = randomUUID();
          await tx.query(
            `INSERT INTO vinops.notification_preferences (
             id, organization_id, project_id, user_id, event_category,
             channel_web, channel_push, channel_email, quiet_hours_start, quiet_hours_end,
             created_at, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())
           ON CONFLICT (project_id, user_id, event_category)
           DO UPDATE SET
             channel_web = EXCLUDED.channel_web,
             channel_push = EXCLUDED.channel_push,
             channel_email = EXCLUDED.channel_email,
             quiet_hours_start = EXCLUDED.quiet_hours_start,
             quiet_hours_end = EXCLUDED.quiet_hours_end,
             updated_at = now()`,
            [
              id,
              organizationId,
              projectId,
              userId,
              pref.eventCategory,
              pref.channelWeb,
              pref.channelPush,
              pref.channelEmail,
              pref.quietHoursStart ?? null,
              pref.quietHoursEnd ?? null,
            ],
          );
          count += 1;
        }

        return {
          projectId,
          updatedCount: count,
          updatedAt: new Date().toISOString(),
        };
      },
    );
  }
}
