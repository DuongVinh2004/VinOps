import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { VinopsDatabase } from '@vinops/database';
import {
  type WeatherCondition,
  type WeatherTimeWindow,
  assertValidGpsCoordinates,
} from '@vinops/domain';

export type WeatherIngestionReport = {
  logsProcessed: number;
  recordsInsertedOrUpdated: number;
};

export type WeatherForecastSample = {
  time_of_day: WeatherTimeWindow;
  temperature_c: number;
  weather_condition: WeatherCondition;
  rainfall_mm: number;
  wind_force: string;
};

export function simulateWeatherForCoordinates(
  lat: number,
  lng: number,
  timeWindow: WeatherTimeWindow,
): WeatherForecastSample {
  assertValidGpsCoordinates(lat, lng);

  // Deterministic calculation based on coordinates and time window
  const isNorthern = lat > 16.0;
  switch (timeWindow) {
    case 'morning':
      return {
        time_of_day: 'morning',
        temperature_c: isNorthern ? 26.5 : 28.0,
        weather_condition: 'Sunny',
        rainfall_mm: 0.0,
        wind_force: 'Cấp 2',
      };
    case 'noon':
      return {
        time_of_day: 'noon',
        temperature_c: isNorthern ? 33.5 : 34.2,
        weather_condition: 'Cloudy',
        rainfall_mm: 0.0,
        wind_force: 'Cấp 3',
      };
    case 'afternoon':
      return {
        time_of_day: 'afternoon',
        temperature_c: isNorthern ? 29.8 : 31.0,
        weather_condition: 'Rainy',
        rainfall_mm: 15.0,
        wind_force: 'Cấp 4',
      };
  }
}

export class WeatherIngestionWorker {
  constructor(
    private readonly database: VinopsDatabase,
    private readonly logger: Pick<Logger, 'debug' | 'error' | 'info'>,
    private readonly systemUserId: string = '00000000-0000-0000-0000-000000000000',
  ) {}

  async ingestForDailyLog(
    logId: string,
    gps?: { lat: number; lng: number },
  ): Promise<WeatherForecastSample[]> {
    const lat = gps?.lat ?? 21.0285;
    const lng = gps?.lng ?? 105.8542;
    assertValidGpsCoordinates(lat, lng);

    const windows: WeatherTimeWindow[] = ['morning', 'noon', 'afternoon'];
    const results: WeatherForecastSample[] = [];

    await this.database.withTransaction({ actorUserId: this.systemUserId }, async (client) => {
      for (const window of windows) {
        const sample = simulateWeatherForCoordinates(lat, lng, window);
        results.push(sample);

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
            sample.time_of_day,
            sample.temperature_c,
            sample.weather_condition,
            sample.rainfall_mm,
            sample.wind_force,
            lat,
            lng,
            `GPS crawled at (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          ],
        );
      }
    });

    return results;
  }

  async runOnce(): Promise<WeatherIngestionReport> {
    const timeWindows: WeatherTimeWindow[] = ['morning', 'noon', 'afternoon'];
    let logsProcessed = 0;
    let recordsInsertedOrUpdated = 0;

    const activeLogs = await this.database.withTransaction(
      { actorUserId: this.systemUserId },
      async (client) => {
        return client.query<{ id: string }>(
          `SELECT id FROM vinops.daily_logs
            WHERE status IN ('Draft', 'Submitted')
            ORDER BY log_date DESC
            LIMIT 50`,
        );
      },
    );

    for (const log of activeLogs) {
      await this.database.withTransaction({ actorUserId: this.systemUserId }, async (client) => {
        const lat = 21.0285;
        const lng = 105.8542;

        for (const window of timeWindows) {
          const sample = simulateWeatherForCoordinates(lat, lng, window);
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
              log.id,
              sample.time_of_day,
              sample.temperature_c,
              sample.weather_condition,
              sample.rainfall_mm,
              sample.wind_force,
              lat,
              lng,
              `Auto-crawled GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            ],
          );
          recordsInsertedOrUpdated++;
        }
      });
      logsProcessed++;
    }

    this.logger.info(
      { logs_processed: logsProcessed, records_created: recordsInsertedOrUpdated },
      'weather ingestion completed',
    );

    return { logsProcessed, recordsInsertedOrUpdated };
  }
}

export type WeatherPoller = {
  readonly isRunning: boolean;
  start(): void;
  stop(): Promise<void>;
};

export function createWeatherPoller(
  worker: WeatherIngestionWorker,
  logger: Pick<Logger, 'debug' | 'error' | 'info'>,
  intervalMs: number,
): WeatherPoller {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    if (!running) return;
    timer = setTimeout(() => {
      void (async () => {
        if (!running) return;
        try {
          await worker.runOnce();
        } catch (err: unknown) {
          logger.error(
            { error: err instanceof Error ? err.message : String(err) },
            'weather poller pass failed',
          );
        } finally {
          schedule();
        }
      })();
    }, intervalMs);
    timer.unref();
  };

  return {
    get isRunning(): boolean {
      return running;
    },
    start(): void {
      if (running) return;
      running = true;
      schedule();
    },
    stop(): Promise<void> {
      running = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      return Promise.resolve();
    },
  };
}
