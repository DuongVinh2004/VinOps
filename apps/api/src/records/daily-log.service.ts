import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import {
  assertDailyLogMutable,
  assertDailyLogConfirmation,
  assertValidGpsCoordinates,
  type DailyLogStatus,
  type WeatherCondition,
  type WeatherTimeWindow,
} from '@vinops/domain';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';

@Injectable()
export class DailyLogService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-daily-log-api',
            runtimeRole: 'vinops_app',
          });
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

  async createDailyLog(
    identity: RequestIdentity,
    projectId: string,
    input: {
      contract_package_id: string;
      log_date: string;
      shift_code?: string;
      author_unit?: string;
      work_summary?: string;
      notes?: string;
    },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const projectRes = await client.query<{ organization_id: string }>(
        'SELECT organization_id FROM vinops.projects WHERE id = $1',
        [projectId],
      );
      if (projectRes.length === 0) {
        throw new PlatformError('PROJECT_NOT_FOUND', 'errors.projectNotFound', 404, false);
      }
      const organizationId = projectRes[0]!.organization_id;

      // Check unique: 1 daily log per day per contract package
      const existing = await client.query(
        'SELECT id FROM vinops.daily_logs WHERE project_id = $1 AND contract_package_id = $2 AND log_date = $3',
        [projectId, input.contract_package_id, input.log_date],
      );
      if (existing.length > 0) {
        throw new PlatformError(
          'DAILY_LOG_DUPLICATE_DATE_PACKAGE',
          'errors.duplicateDailyLog',
          409,
          false,
        );
      }

      const logId = randomUUID();
      await client.query(
        `INSERT INTO vinops.daily_logs (
            id, organization_id, project_id, contract_package_id, log_date, shift_code, status, author_unit, work_summary, notes, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, 'Draft', $7, $8, $9, $10)`,
        [
          logId,
          organizationId,
          projectId,
          input.contract_package_id,
          input.log_date,
          input.shift_code ?? 'day',
          input.author_unit ?? 'Chính',
          input.work_summary ?? '',
          input.notes ?? '',
          identity.userId,
        ],
      );

      return this.getDailyLogById(client, logId);
    });
  }

  async getDailyLog(
    identity: RequestIdentity,
    logId: string,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) =>
      this.getDailyLogById(client, logId),
    );
  }

  async listDailyLogs(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<{ items: unknown[]; page: { next_cursor: null; has_more: false } }> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const res = await client.query(
        `SELECT l.*,
                  COALESCE((SELECT json_agg(m) FROM vinops.daily_manpower m WHERE m.daily_log_id = l.id), '[]') AS manpower,
                  COALESCE((SELECT json_agg(e) FROM vinops.daily_equipment e WHERE e.daily_log_id = l.id), '[]') AS equipment,
                  COALESCE((SELECT json_agg(w ORDER BY w.time_of_day) FROM vinops.daily_weather w WHERE w.daily_log_id = l.id), '[]') AS weather
             FROM vinops.daily_logs l
            WHERE l.project_id = $1
            ORDER BY l.log_date DESC`,
        [projectId],
      );
      return { items: [...res], page: { next_cursor: null, has_more: false } };
    });
  }

  private async getDailyLogById(client: Transaction, logId: string): Promise<unknown> {
    const res = await client.query(
      `SELECT l.*,
              COALESCE((SELECT json_agg(m) FROM vinops.daily_manpower m WHERE m.daily_log_id = l.id), '[]') AS manpower,
              COALESCE((SELECT json_agg(e) FROM vinops.daily_equipment e WHERE e.daily_log_id = l.id), '[]') AS equipment,
              COALESCE((SELECT json_agg(w ORDER BY w.time_of_day) FROM vinops.daily_weather w WHERE w.daily_log_id = l.id), '[]') AS weather
         FROM vinops.daily_logs l
        WHERE l.id = $1`,
      [logId],
    );
    if (res.length === 0) {
      throw new PlatformError('DAILY_LOG_NOT_FOUND', 'errors.notFound', 404, false);
    }
    return res[0];
  }

  async updateDailyLog(
    identity: RequestIdentity,
    logId: string,
    input: {
      work_summary?: string | undefined;
      notes?: string | undefined;
      author_unit?: string | undefined;
    },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const currentRes = await client.query<{ status: DailyLogStatus }>(
        'SELECT status FROM vinops.daily_logs WHERE id = $1 FOR UPDATE',
        [logId],
      );
      if (currentRes.length === 0) {
        throw new PlatformError('DAILY_LOG_NOT_FOUND', 'errors.notFound', 404, false);
      }
      // Invariant check: Confirmed log is frozen
      assertDailyLogMutable({ id: logId, status: currentRes[0]!.status });

      await client.query(
        `UPDATE vinops.daily_logs
              SET work_summary = COALESCE($2, work_summary),
                  notes = COALESCE($3, notes),
                  author_unit = COALESCE($4, author_unit),
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1`,
        [logId, input.work_summary ?? null, input.notes ?? null, input.author_unit ?? null],
      );

      return this.getDailyLogById(client, logId);
    });
  }

  async saveManpower(
    identity: RequestIdentity,
    logId: string,
    items: Array<{
      trade_or_subcontractor: string;
      skill_level?: string;
      headcount: number;
      hours_worked?: number;
      notes?: string;
    }>,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const currentRes = await client.query<{ status: DailyLogStatus }>(
        'SELECT status FROM vinops.daily_logs WHERE id = $1 FOR UPDATE',
        [logId],
      );
      if (currentRes.length === 0) {
        throw new PlatformError('DAILY_LOG_NOT_FOUND', 'errors.notFound', 404, false);
      }
      assertDailyLogMutable({ id: logId, status: currentRes[0]!.status });

      await client.query('DELETE FROM vinops.daily_manpower WHERE daily_log_id = $1', [logId]);

      for (const item of items) {
        await client.query(
          `INSERT INTO vinops.daily_manpower (
              id, daily_log_id, trade_or_subcontractor, skill_level, headcount, hours_worked, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            logId,
            item.trade_or_subcontractor,
            item.skill_level ?? 'Skilled',
            item.headcount,
            item.hours_worked ?? 8.0,
            item.notes ?? '',
          ],
        );
      }

      return this.getDailyLogById(client, logId);
    });
  }

  async saveEquipment(
    identity: RequestIdentity,
    logId: string,
    items: Array<{
      equipment_name: string;
      equipment_type?: string;
      quantity: number;
      hours_worked?: number;
      operational_status?: 'Operational' | 'Standby' | 'Breakdown';
      notes?: string;
    }>,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const currentRes = await client.query<{ status: DailyLogStatus }>(
        'SELECT status FROM vinops.daily_logs WHERE id = $1 FOR UPDATE',
        [logId],
      );
      if (currentRes.length === 0) {
        throw new PlatformError('DAILY_LOG_NOT_FOUND', 'errors.notFound', 404, false);
      }
      assertDailyLogMutable({ id: logId, status: currentRes[0]!.status });

      await client.query('DELETE FROM vinops.daily_equipment WHERE daily_log_id = $1', [logId]);

      for (const item of items) {
        await client.query(
          `INSERT INTO vinops.daily_equipment (
              id, daily_log_id, equipment_name, equipment_type, quantity, hours_worked, operational_status, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            logId,
            item.equipment_name,
            item.equipment_type ?? 'General',
            item.quantity,
            item.hours_worked ?? 8.0,
            item.operational_status ?? 'Operational',
            item.notes ?? '',
          ],
        );
      }

      return this.getDailyLogById(client, logId);
    });
  }

  async saveWeather(
    identity: RequestIdentity,
    logId: string,
    items: Array<{
      time_of_day: WeatherTimeWindow;
      temperature_c: number;
      weather_condition?: WeatherCondition;
      rainfall_mm?: number;
      wind_force?: string;
      gps_lat?: number;
      gps_lng?: number;
      source?: 'manual' | 'crawled';
      notes?: string;
    }>,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const currentRes = await client.query<{ status: DailyLogStatus }>(
        'SELECT status FROM vinops.daily_logs WHERE id = $1 FOR UPDATE',
        [logId],
      );
      if (currentRes.length === 0) {
        throw new PlatformError('DAILY_LOG_NOT_FOUND', 'errors.notFound', 404, false);
      }
      assertDailyLogMutable({ id: logId, status: currentRes[0]!.status });

      for (const item of items) {
        await client.query(
          `INSERT INTO vinops.daily_weather (
              id, daily_log_id, time_of_day, temperature_c, weather_condition, rainfall_mm, wind_force, gps_lat, gps_lng, source, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (daily_log_id, time_of_day) DO UPDATE
              SET temperature_c = EXCLUDED.temperature_c,
                  weather_condition = EXCLUDED.weather_condition,
                  rainfall_mm = EXCLUDED.rainfall_mm,
                  wind_force = EXCLUDED.wind_force,
                  gps_lat = EXCLUDED.gps_lat,
                  gps_lng = EXCLUDED.gps_lng,
                  source = EXCLUDED.source,
                  notes = EXCLUDED.notes,
                  recorded_at = now()`,
          [
            randomUUID(),
            logId,
            item.time_of_day,
            item.temperature_c,
            item.weather_condition ?? 'Sunny',
            item.rainfall_mm ?? 0.0,
            item.wind_force ?? 'Light',
            item.gps_lat ?? null,
            item.gps_lng ?? null,
            item.source ?? 'manual',
            item.notes ?? '',
          ],
        );
      }

      return this.getDailyLogById(client, logId);
    });
  }

  async crawlWeatherByGps(
    identity: RequestIdentity,
    logId: string,
    gps?: { lat: number; lng: number },
    correlationId?: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, ...(correlationId ? { correlationId } : {}) },
      async (client) => {
        const currentRes = await client.query<{ status: DailyLogStatus }>(
          'SELECT status FROM vinops.daily_logs WHERE id = $1 FOR UPDATE',
          [logId],
        );
        if (currentRes.length === 0) {
          throw new PlatformError('DAILY_LOG_NOT_FOUND', 'errors.notFound', 404, false);
        }
        assertDailyLogMutable({ id: logId, status: currentRes[0]!.status });

        const lat = gps?.lat ?? 21.0285; // Default Hanoi/VN coordinates
        const lng = gps?.lng ?? 105.8542;
        assertValidGpsCoordinates(lat, lng);

        // Deterministic simulated crawled weather for the 3 time windows
        const shifts: Array<{
          time_of_day: WeatherTimeWindow;
          temperature_c: number;
          weather_condition: WeatherCondition;
          rainfall_mm: number;
          wind_force: string;
        }> = [
          {
            time_of_day: 'morning',
            temperature_c: 28.0,
            weather_condition: 'Sunny',
            rainfall_mm: 0.0,
            wind_force: 'Level 2',
          },
          {
            time_of_day: 'noon',
            temperature_c: 34.5,
            weather_condition: 'Cloudy',
            rainfall_mm: 0.0,
            wind_force: 'Level 3',
          },
          {
            time_of_day: 'afternoon',
            temperature_c: 30.2,
            weather_condition: 'Rainy',
            rainfall_mm: 12.5,
            wind_force: 'Level 4',
          },
        ];

        for (const shift of shifts) {
          await client.query(
            `INSERT INTO vinops.daily_weather (
              id, daily_log_id, time_of_day, temperature_c, weather_condition, rainfall_mm, wind_force, gps_lat, gps_lng, source, notes
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'crawled', $10)
            ON CONFLICT (daily_log_id, time_of_day) DO UPDATE
              SET temperature_c = EXCLUDED.temperature_c,
                  weather_condition = EXCLUDED.weather_condition,
                  rainfall_mm = EXCLUDED.rainfall_mm,
                  wind_force = EXCLUDED.wind_force,
                  gps_lat = EXCLUDED.gps_lat,
                  gps_lng = EXCLUDED.gps_lng,
                  source = 'crawled',
                  notes = EXCLUDED.notes,
                  recorded_at = now()`,
            [
              randomUUID(),
              logId,
              shift.time_of_day,
              shift.temperature_c,
              shift.weather_condition,
              shift.rainfall_mm,
              shift.wind_force,
              lat,
              lng,
              `GPS crawled at (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            ],
          );
        }

        return this.getDailyLogById(client, logId);
      },
    );
  }

  async signSiteManager(
    identity: RequestIdentity,
    logId: string,
    signatureData: string,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const logRes = await client.query<{
        status: DailyLogStatus;
        supervisor_signed_by: string | null;
      }>('SELECT status, supervisor_signed_by FROM vinops.daily_logs WHERE id = $1 FOR UPDATE', [
        logId,
      ]);
      if (logRes.length === 0) {
        throw new PlatformError('DAILY_LOG_NOT_FOUND', 'errors.notFound', 404, false);
      }
      assertDailyLogMutable({ id: logId, status: logRes[0]!.status });

      const bothSigned = logRes[0]!.supervisor_signed_by !== null;
      const newStatus: DailyLogStatus = bothSigned ? 'Confirmed' : 'Submitted';

      await client.query(
        `UPDATE vinops.daily_logs
              SET site_manager_signed_by = $2,
                  site_manager_signed_at = now(),
                  site_manager_signature_data = $3,
                  status = $4,
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1`,
        [logId, identity.userId, signatureData, newStatus],
      );

      return this.getDailyLogById(client, logId);
    });
  }

  async signSupervisor(
    identity: RequestIdentity,
    logId: string,
    signatureData: string,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const logRes = await client.query<{
        status: DailyLogStatus;
        site_manager_signed_by: string | null;
      }>('SELECT status, site_manager_signed_by FROM vinops.daily_logs WHERE id = $1 FOR UPDATE', [
        logId,
      ]);
      if (logRes.length === 0) {
        throw new PlatformError('DAILY_LOG_NOT_FOUND', 'errors.notFound', 404, false);
      }
      assertDailyLogMutable({ id: logId, status: logRes[0]!.status });

      // When both have signed, status is locked as 'Confirmed'
      const bothSigned = logRes[0]!.site_manager_signed_by !== null;
      const newStatus: DailyLogStatus = bothSigned ? 'Confirmed' : 'Submitted';

      if (bothSigned) {
        assertDailyLogConfirmation({
          siteManagerSigned: true,
          supervisorSigned: true,
        });
      }

      await client.query(
        `UPDATE vinops.daily_logs
              SET supervisor_signed_by = $2,
                  supervisor_signed_at = now(),
                  supervisor_signature_data = $3,
                  status = $4,
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1`,
        [logId, identity.userId, signatureData, newStatus],
      );

      return this.getDailyLogById(client, logId);
    });
  }
}
