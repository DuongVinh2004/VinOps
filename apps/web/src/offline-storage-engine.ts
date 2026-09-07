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

export class OfflineStorageEngine {
  private static readonly STORAGE_KEY = 'vinops_offline_queue';
  private static readonly CACHE_LOGS_KEY = 'vinops_cached_daily_logs';
  private static readonly CACHE_INSPECTIONS_KEY = 'vinops_cached_inspections';
  private inMemoryQueue: OfflineQueueItem[] = [];
  private inMemoryLogs: Record<string, unknown[]> = {};
  private inMemoryInspections: Record<string, unknown[]> = {};

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

  async flushSyncQueue(
    client: VinopsApiClient,
    projectId: string,
  ): Promise<{ syncedCount: number; conflictCount: number }> {
    const pending = this.getPendingOperations();
    if (pending.length === 0) {
      return { syncedCount: 0, conflictCount: 0 };
    }

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
  }
}
