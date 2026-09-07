import type { VinopsApiClient } from './api.js';

export type OfflineQueueItem = {
  operation_id: string;
  entity_type: 'daily_log' | 'inspection' | 'acceptance_record';
  entity_temp_id: string;
  command: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  base_version?: number;
  client_created_at: string;
};

export type CachedGpsLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  timestamp: string;
};

export class OfflineStorageEngine {
  private static readonly STORAGE_KEY = 'vinops_offline_queue';
  private static readonly CACHE_LOGS_KEY = 'vinops_cached_daily_logs';
  private static readonly CACHE_INSPECTIONS_KEY = 'vinops_cached_inspections';
  private static readonly CACHE_GPS_KEY = 'vinops_cached_gps';
  private inMemoryQueue: OfflineQueueItem[] = [];
  private inMemoryLogs: Record<string, unknown[]> = {};
  private inMemoryInspections: Record<string, unknown[]> = {};
  private inMemoryGps: Record<string, CachedGpsLocation> = {};
  private isSyncing = false;

  constructor(
    private readonly deviceId: string = 'web-device-' + Math.random().toString(36).slice(2),
  ) {}

  private getStorage(): Storage | null {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    return null;
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  enqueueOperation(item: OfflineQueueItem): void {
    const storage = this.getStorage();
    if (storage) {
      const items = this.getPendingOperations();
      items.push(item);
      storage.setItem(OfflineStorageEngine.STORAGE_KEY, JSON.stringify(items));
    } else {
      this.inMemoryQueue.push(item);
    }
  }

  getPendingOperations(): OfflineQueueItem[] {
    const storage = this.getStorage();
    if (storage) {
      const raw = storage.getItem(OfflineStorageEngine.STORAGE_KEY);
      if (!raw) return [];
      try {
        return JSON.parse(raw) as OfflineQueueItem[];
      } catch {
        return [];
      }
    }
    return [...this.inMemoryQueue];
  }

  removeOperations(operationIds: readonly string[]): void {
    const set = new Set(operationIds);
    const storage = this.getStorage();
    if (storage) {
      const remaining = this.getPendingOperations().filter((op) => !set.has(op.operation_id));
      storage.setItem(OfflineStorageEngine.STORAGE_KEY, JSON.stringify(remaining));
    } else {
      this.inMemoryQueue = this.inMemoryQueue.filter((op) => !set.has(op.operation_id));
    }
  }

  clearQueue(): void {
    const storage = this.getStorage();
    if (storage) {
      storage.removeItem(OfflineStorageEngine.STORAGE_KEY);
    } else {
      this.inMemoryQueue = [];
    }
  }

  cacheDailyLogs(projectId: string, logs: readonly unknown[]): void {
    const storage = this.getStorage();
    if (storage) {
      storage.setItem(`${OfflineStorageEngine.CACHE_LOGS_KEY}_${projectId}`, JSON.stringify(logs));
    } else {
      this.inMemoryLogs[projectId] = [...logs];
    }
  }

  getCachedDailyLogs(projectId: string): unknown[] {
    const storage = this.getStorage();
    if (storage) {
      const raw = storage.getItem(`${OfflineStorageEngine.CACHE_LOGS_KEY}_${projectId}`);
      if (!raw) return [];
      try {
        return JSON.parse(raw) as unknown[];
      } catch {
        return [];
      }
    }
    return this.inMemoryLogs[projectId] ?? [];
  }

  cacheInspections(projectId: string, inspections: readonly unknown[]): void {
    const storage = this.getStorage();
    if (storage) {
      storage.setItem(
        `${OfflineStorageEngine.CACHE_INSPECTIONS_KEY}_${projectId}`,
        JSON.stringify(inspections),
      );
    } else {
      this.inMemoryInspections[projectId] = [...inspections];
    }
  }

  getCachedInspections(projectId: string): unknown[] {
    const storage = this.getStorage();
    if (storage) {
      const raw = storage.getItem(`${OfflineStorageEngine.CACHE_INSPECTIONS_KEY}_${projectId}`);
      if (!raw) return [];
      try {
        return JSON.parse(raw) as unknown[];
      } catch {
        return [];
      }
    }
    return this.inMemoryInspections[projectId] ?? [];
  }

  cacheGpsLocation(entityId: string, location: CachedGpsLocation): void {
    const storage = this.getStorage();
    if (storage) {
      const existing = this.extractAllCachedGpsLocations();
      existing[entityId] = location;
      storage.setItem(OfflineStorageEngine.CACHE_GPS_KEY, JSON.stringify(existing));
    } else {
      this.inMemoryGps[entityId] = location;
    }
  }

  getCachedGpsLocation(entityId: string): CachedGpsLocation | null {
    const storage = this.getStorage();
    if (storage) {
      const raw = storage.getItem(OfflineStorageEngine.CACHE_GPS_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Record<string, CachedGpsLocation>;
        return parsed[entityId] ?? null;
      } catch {
        return null;
      }
    }
    return this.inMemoryGps[entityId] ?? null;
  }

  extractAllCachedGpsLocations(): Record<string, CachedGpsLocation> {
    const storage = this.getStorage();
    if (storage) {
      const raw = storage.getItem(OfflineStorageEngine.CACHE_GPS_KEY);
      if (!raw) return {};
      try {
        return JSON.parse(raw) as Record<string, CachedGpsLocation>;
      } catch {
        return {};
      }
    }
    return { ...this.inMemoryGps };
  }

  extractGpsFromPendingOperations(): Array<{
    entityId: string;
    gps: { latitude: number; longitude: number; accuracy?: number };
  }> {
    const pending = this.getPendingOperations();
    const result: Array<{
      entityId: string;
      gps: { latitude: number; longitude: number; accuracy?: number };
    }> = [];

    for (const op of pending) {
      const payload = op.payload;
      if (!payload) continue;

      let lat: number | undefined;
      let lng: number | undefined;
      let acc: number | undefined;

      if (typeof payload.gps_latitude === 'number' && typeof payload.gps_longitude === 'number') {
        lat = payload.gps_latitude;
        lng = payload.gps_longitude;
        acc = typeof payload.gps_accuracy === 'number' ? payload.gps_accuracy : undefined;
      } else if (typeof payload.gps_lat === 'number' && typeof payload.gps_lng === 'number') {
        lat = payload.gps_lat;
        lng = payload.gps_lng;
        acc = typeof payload.gps_accuracy === 'number' ? payload.gps_accuracy : undefined;
      } else if (
        typeof payload.gps === 'object' &&
        payload.gps !== null &&
        'lat' in payload.gps &&
        'lng' in payload.gps
      ) {
        const gpsObj = payload.gps as { lat: unknown; lng: unknown; accuracy?: unknown };
        if (typeof gpsObj.lat === 'number' && typeof gpsObj.lng === 'number') {
          lat = gpsObj.lat;
          lng = gpsObj.lng;
          acc = typeof gpsObj.accuracy === 'number' ? gpsObj.accuracy : undefined;
        }
      }

      if (lat !== undefined && lng !== undefined) {
        result.push({
          entityId: op.entity_temp_id,
          gps: { latitude: lat, longitude: lng, ...(acc !== undefined ? { accuracy: acc } : {}) },
        });
      }
    }

    return result;
  }

  async flushSyncQueue(
    client: VinopsApiClient,
    projectId: string,
  ): Promise<{ syncedCount: number; conflictCount: number; inFlight?: boolean }> {
    if (this.isSyncing) {
      return { syncedCount: 0, conflictCount: 0, inFlight: true };
    }

    const pending = this.getPendingOperations();
    if (pending.length === 0) {
      return { syncedCount: 0, conflictCount: 0 };
    }

    this.isSyncing = true;
    try {
      const payload = {
        device_id: this.deviceId,
        operations: pending,
      };

      const res = (await client.syncOfflineBatch(projectId, payload)) as {
        applied_count: number;
        conflict_count: number;
        operations?: Array<{ operation_id: string; status: string }>;
      };

      const appliedIds = (res.operations ?? [])
        .filter((op) => op.status === 'applied')
        .map((op) => op.operation_id);

      if (appliedIds.length > 0) {
        this.removeOperations(appliedIds);
      }

      return {
        syncedCount: res.applied_count ?? 0,
        conflictCount: res.conflict_count ?? 0,
      };
    } finally {
      this.isSyncing = false;
    }
  }
}
