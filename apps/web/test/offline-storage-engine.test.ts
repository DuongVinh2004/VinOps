// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  OfflineStorageEngine,
  type OfflineQueueItem,
  type CachedGpsLocation,
} from '../src/offline-storage-engine.js';
import type { VinopsApiClient } from '../src/api.js';

function createMockStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
}

describe('OfflineStorageEngine (ADR-007 Verification)', () => {
  let engine: OfflineStorageEngine;
  let mockStorage: Storage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
    engine = new OfflineStorageEngine('test-device-01');
  });

  afterEach(() => {
    mockStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Basic Queue Operations & Storage Isolation', () => {
    it('enqueues and retrieves operations via localStorage', () => {
      const op: OfflineQueueItem = {
        operation_id: 'op-001',
        entity_type: 'daily_log',
        entity_temp_id: 'temp-log-1',
        command: 'create',
        payload: { summary: 'Hôm nay đổ bê tông sàn tầng 3' },
        client_created_at: new Date().toISOString(),
      };

      engine.enqueueOperation(op);
      const pending = engine.getPendingOperations();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.operation_id).toBe('op-001');

      engine.removeOperations(['op-001']);
      expect(engine.getPendingOperations()).toHaveLength(0);
    });

    it('falls back seamlessly to in-memory queue when localStorage is unavailable', () => {
      Object.defineProperty(window, 'localStorage', {
        value: null,
        writable: true,
        configurable: true,
      });
      const memEngine = new OfflineStorageEngine('device-memory-only');

      const op: OfflineQueueItem = {
        operation_id: 'op-mem-01',
        entity_type: 'inspection',
        entity_temp_id: 'ins-01',
        command: 'update',
        payload: { status: 'In Progress' },
        client_created_at: new Date().toISOString(),
      };

      memEngine.enqueueOperation(op);
      expect(memEngine.getPendingOperations()).toHaveLength(1);
      expect(memEngine.getPendingOperations()[0]?.operation_id).toBe('op-mem-01');

      memEngine.removeOperations(['op-mem-01']);
      expect(memEngine.getPendingOperations()).toHaveLength(0);
    });

    it('clears queue completely on clearQueue call', () => {
      engine.enqueueOperation({
        operation_id: 'op-002',
        entity_type: 'acceptance_record',
        entity_temp_id: 'acc-01',
        command: 'create',
        payload: {},
        client_created_at: new Date().toISOString(),
      });
      expect(engine.getPendingOperations()).toHaveLength(1);

      engine.clearQueue();
      expect(engine.getPendingOperations()).toHaveLength(0);
    });
  });

  describe('Flaky Network, Network Outage, and Retry Handling', () => {
    it('retains pending queue untouched when sync fails due to network outage', async () => {
      engine.enqueueOperation({
        operation_id: 'op-net-fail',
        entity_type: 'daily_log',
        entity_temp_id: 'log-001',
        command: 'update',
        payload: { weather: 'Rain' },
        client_created_at: new Date().toISOString(),
      });

      const mockClient = {
        syncOfflineBatch: vi
          .fn()
          .mockRejectedValue(new Error('Network request failed: ECONNREFUSED')),
      } as unknown as VinopsApiClient;

      await expect(engine.flushSyncQueue(mockClient, 'proj-1')).rejects.toThrow(
        'Network request failed',
      );

      // Tác vụ phải được giữ nguyên trong hàng đợi để thử lại khi có mạng
      const pending = engine.getPendingOperations();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.operation_id).toBe('op-net-fail');
    });

    it('handles flaky network with partial retry: removes applied ops, retains failed/unapplied ops', async () => {
      engine.enqueueOperation({
        operation_id: 'op-batch-1',
        entity_type: 'daily_log',
        entity_temp_id: 'log-001',
        command: 'create',
        payload: { notes: 'Batch item 1' },
        client_created_at: new Date().toISOString(),
      });
      engine.enqueueOperation({
        operation_id: 'op-batch-2',
        entity_type: 'inspection',
        entity_temp_id: 'ins-002',
        command: 'update',
        payload: { notes: 'Batch item 2' },
        client_created_at: new Date().toISOString(),
      });

      // Server applies op-batch-1, but rejects/delays op-batch-2
      const mockClient = {
        syncOfflineBatch: vi.fn().mockResolvedValue({
          applied_count: 1,
          conflict_count: 0,
          operations: [
            { operation_id: 'op-batch-1', status: 'applied' },
            { operation_id: 'op-batch-2', status: 'retryable_error' },
          ],
        }),
      } as unknown as VinopsApiClient;

      const res = await engine.flushSyncQueue(mockClient, 'proj-1');
      expect(res.syncedCount).toBe(1);
      expect(res.conflictCount).toBe(0);

      // op-batch-1 was removed, op-batch-2 remains in queue for next sync cycle
      const remaining = engine.getPendingOperations();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.operation_id).toBe('op-batch-2');
    });
  });

  describe('Concurrent Sync and Parallel Batch In-Flight Guard', () => {
    it('prevents concurrent flushSyncQueue execution from duplicating network requests', async () => {
      engine.enqueueOperation({
        operation_id: 'op-concurrent',
        entity_type: 'daily_log',
        entity_temp_id: 'log-conc',
        command: 'create',
        payload: {},
        client_created_at: new Date().toISOString(),
      });

      let resolveCall: (value: unknown) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveCall = resolve;
      });

      const syncSpy = vi.fn().mockImplementation(() => delayedPromise);
      const mockClient = {
        syncOfflineBatch: syncSpy,
      } as unknown as VinopsApiClient;

      // Kích hoạt flush đầu tiên (đang in-flight)
      const firstFlushPromise = engine.flushSyncQueue(mockClient, 'proj-1');

      // Kích hoạt flush thứ hai đồng thời
      const secondFlushResult = await engine.flushSyncQueue(mockClient, 'proj-1');

      // Lần gọi thứ 2 phải được bảo vệ bởi inFlight guard và không tạo thêm request
      expect(secondFlushResult.inFlight).toBe(true);
      expect(secondFlushResult.syncedCount).toBe(0);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      // Kết thúc lời gọi đầu tiên
      resolveCall!({
        applied_count: 1,
        conflict_count: 0,
        operations: [{ operation_id: 'op-concurrent', status: 'applied' }],
      });

      const firstResult = await firstFlushPromise;
      expect(firstResult.syncedCount).toBe(1);
      expect(engine.getPendingOperations()).toHaveLength(0);
    });
  });

  describe('Version Conflict Resolution (2 Devices Concurrent Edit)', () => {
    it('accurately identifies and reports version conflicts when server reports conflict', async () => {
      // Device 1 & Device 2 cả 2 cùng sửa Daily Log log-conflict-10
      // Device 1 có base_version: 1, nhưng máy chủ đã lên version 2 do Device 2 gửi trước
      engine.enqueueOperation({
        operation_id: 'op-device1-edit',
        entity_type: 'daily_log',
        entity_temp_id: 'log-conflict-10',
        command: 'update',
        base_version: 1,
        payload: { workSummary: 'Bảo dưỡng bê tông bởi Device 1' },
        client_created_at: '2026-09-07T08:30:00.000Z',
      });

      const mockClient = {
        syncOfflineBatch: vi.fn().mockResolvedValue({
          applied_count: 0,
          conflict_count: 1,
          operations: [
            {
              operation_id: 'op-device1-edit',
              status: 'conflict',
              server_version: 2,
              reason: 'Version drift: server version 2 > client base version 1',
            },
          ],
        }),
      } as unknown as VinopsApiClient;

      const res = await engine.flushSyncQueue(mockClient, 'proj-1');
      expect(res.syncedCount).toBe(0);
      expect(res.conflictCount).toBe(1);

      // Tác vụ xung đột không bị xóa âm thầm khỏi hàng đợi để người dùng giải quyết
      const pending = engine.getPendingOperations();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.operation_id).toBe('op-device1-edit');
    });

    it('resolves mixed batch with some applied and some conflict operations', async () => {
      engine.enqueueOperation({
        operation_id: 'op-clean-1',
        entity_type: 'inspection',
        entity_temp_id: 'ins-101',
        command: 'create',
        base_version: 1,
        payload: { checklist_item: 'item_1', result: 'Pass' },
        client_created_at: new Date().toISOString(),
      });
      engine.enqueueOperation({
        operation_id: 'op-conflict-2',
        entity_type: 'inspection',
        entity_temp_id: 'ins-102',
        command: 'update',
        base_version: 1,
        payload: { checklist_item: 'item_2', result: 'Fail' },
        client_created_at: new Date().toISOString(),
      });

      const mockClient = {
        syncOfflineBatch: vi.fn().mockResolvedValue({
          applied_count: 1,
          conflict_count: 1,
          operations: [
            { operation_id: 'op-clean-1', status: 'applied' },
            { operation_id: 'op-conflict-2', status: 'conflict', reason: 'server_authoritative' },
          ],
        }),
      } as unknown as VinopsApiClient;

      const res = await engine.flushSyncQueue(mockClient, 'proj-1');
      expect(res.syncedCount).toBe(1);
      expect(res.conflictCount).toBe(1);

      const remaining = engine.getPendingOperations();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.operation_id).toBe('op-conflict-2');
    });
  });

  describe('Offline GPS Storage & Extraction', () => {
    it('stores and extracts offline GPS coordinates with accuracy and timestamp', () => {
      const location: CachedGpsLocation = {
        latitude: 21.028511,
        longitude: 105.854167,
        accuracy: 4.5,
        timestamp: '2026-09-07T09:00:00.000Z',
      };

      engine.cacheGpsLocation('log-site-01', location);

      const retrieved = engine.getCachedGpsLocation('log-site-01');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.latitude).toBeCloseTo(21.028511, 5);
      expect(retrieved?.longitude).toBeCloseTo(105.854167, 5);
      expect(retrieved?.accuracy).toBe(4.5);

      const allGps = engine.extractAllCachedGpsLocations();
      expect(allGps['log-site-01']).toEqual(location);
    });

    it('extracts GPS telemetry automatically from offline queued operations', () => {
      engine.enqueueOperation({
        operation_id: 'op-gps-1',
        entity_type: 'daily_log',
        entity_temp_id: 'temp-daily-log-gps',
        command: 'create',
        payload: {
          workSummary: 'Thi công cọc khoan nhồi',
          gps_latitude: 21.0312,
          gps_longitude: 105.8456,
          gps_accuracy: 3.2,
        },
        client_created_at: new Date().toISOString(),
      });

      engine.enqueueOperation({
        operation_id: 'op-gps-2',
        entity_type: 'inspection',
        entity_temp_id: 'temp-inspection-gps',
        command: 'update',
        payload: {
          gps: {
            lat: 21.0315,
            lng: 105.846,
            accuracy: 5.0,
          },
        },
        client_created_at: new Date().toISOString(),
      });

      // Op without GPS
      engine.enqueueOperation({
        operation_id: 'op-no-gps',
        entity_type: 'acceptance_record',
        entity_temp_id: 'temp-acc',
        command: 'create',
        payload: { notes: 'No GPS data' },
        client_created_at: new Date().toISOString(),
      });

      const extracted = engine.extractGpsFromPendingOperations();
      expect(extracted).toHaveLength(2);

      const dailyLogGps = extracted.find((item) => item.entityId === 'temp-daily-log-gps');
      expect(dailyLogGps).toBeDefined();
      expect(dailyLogGps?.gps.latitude).toBeCloseTo(21.0312, 4);
      expect(dailyLogGps?.gps.longitude).toBeCloseTo(105.8456, 4);
      expect(dailyLogGps?.gps.accuracy).toBe(3.2);

      const inspectGps = extracted.find((item) => item.entityId === 'temp-inspection-gps');
      expect(inspectGps).toBeDefined();
      expect(inspectGps?.gps.latitude).toBeCloseTo(21.0315, 4);
      expect(inspectGps?.gps.longitude).toBeCloseTo(105.846, 4);
      expect(inspectGps?.gps.accuracy).toBe(5.0);
    });

    it('persists GPS data in memory fallback when localStorage throws or is null', () => {
      Object.defineProperty(window, 'localStorage', {
        value: null,
        writable: true,
        configurable: true,
      });
      const memEngine = new OfflineStorageEngine('mem-gps-device');

      const loc: CachedGpsLocation = {
        latitude: 10.7769,
        longitude: 106.7009,
        timestamp: '2026-09-07T09:15:00.000Z',
      };

      memEngine.cacheGpsLocation('item-sg-01', loc);
      expect(memEngine.getCachedGpsLocation('item-sg-01')).toEqual(loc);
      expect(memEngine.extractAllCachedGpsLocations()['item-sg-01']).toEqual(loc);
    });
  });
});
