import React, { useState, useEffect } from 'react';
import type { VinopsApiClient, Inspection } from './api.js';
import { OfflineStorageEngine } from './offline-storage-engine.js';

export type MobileSiteInspectionProps = {
  projectId: string;
  client: VinopsApiClient;
  inspections?: readonly Inspection[];
  onRefresh?: () => Promise<void>;
};

export function MobileSiteInspection({
  projectId,
  client,
  inspections = [],
  onRefresh,
}: MobileSiteInspectionProps): React.JSX.Element {
  const [offlineEngine] = useState(() => new OfflineStorageEngine());
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [activeInspection, setActiveInspection] = useState<Inspection | null>(
    inspections[0] ?? null,
  );
  const [checklistResults, setChecklistResults] = useState<Record<string, 'Pass' | 'Fail' | 'NA'>>(
    {},
  );
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    setPendingSyncCount(offlineEngine.getPendingOperations().length);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [offlineEngine]);

  useEffect(() => {
    if (inspections.length > 0 && !activeInspection) {
      setActiveInspection(inspections[0]!);
    }
  }, [inspections, activeInspection]);

  const handleResultToggle = (itemId: string, result: 'Pass' | 'Fail' | 'NA') => {
    setChecklistResults((prev) => ({ ...prev, [itemId]: result }));
  };

  const handleSaveInspection = async () => {
    if (!activeInspection) return;

    const payload = {
      inspection_id: activeInspection.id,
      results: Object.entries(checklistResults).map(([key, res]) => ({
        item_key: key,
        result: res,
      })),
      timestamp: new Date().toISOString(),
    };

    if (isOnline) {
      try {
        await client.submitChecklistResults(activeInspection.id, payload.results);
        setStatusMessage('Đã gửi kết quả kiểm tra lên máy chủ.');
        if (onRefresh) await onRefresh();
      } catch {
        // Fallback to offline queue
        offlineEngine.enqueueOperation({
          operation_id: `op-${Date.now()}`,
          entity_type: 'inspection',
          entity_temp_id: activeInspection.id,
          command: 'update',
          payload,
          client_created_at: new Date().toISOString(),
        });
        setPendingSyncCount(offlineEngine.getPendingOperations().length);
        setStatusMessage('Đã lưu ngoại tuyến do mạng không ổn định.');
      }
    } else {
      offlineEngine.enqueueOperation({
        operation_id: `op-${Date.now()}`,
        entity_type: 'inspection',
        entity_temp_id: activeInspection.id,
        command: 'update',
        payload,
        client_created_at: new Date().toISOString(),
      });
      setPendingSyncCount(offlineEngine.getPendingOperations().length);
      setStatusMessage('Đang ngoại tuyến: Đã lưu vào bộ nhớ đệm thiết bị.');
    }
  };

  const handleSyncNow = async () => {
    try {
      const res = await offlineEngine.flushSyncQueue(client, projectId);
      setPendingSyncCount(offlineEngine.getPendingOperations().length);
      setStatusMessage(
        `Đồng bộ thành công: ${res.syncedCount} tác vụ, ${res.conflictCount} xung đột.`,
      );
      if (onRefresh) await onRefresh();
    } catch (err: unknown) {
      setStatusMessage(`Đồng bộ thất bại: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="mobile-site-inspection-container" data-testid="mobile-site-inspection">
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <h2>Kiểm tra Chất lượng Hiện trường (Tablet Mode)</h2>
          <span
            data-testid="connection-status"
            style={{
              display: 'inline-block',
              padding: '4px 8px',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 'bold',
              background: isOnline ? '#e6f4ea' : '#fce8e6',
              color: isOnline ? '#137333' : '#c5221f',
            }}
          >
            {isOnline ? '🟢 TRỰC TUYẾN' : '🔴 NGOẠI TUYẾN'}
          </span>
          {pendingSyncCount > 0 && (
            <span
              data-testid="pending-sync-badge"
              style={{
                marginLeft: 8,
                padding: '4px 8px',
                borderRadius: 4,
                background: '#fff0d4',
                color: '#b06000',
                fontSize: 12,
              }}
            >
              Chờ đồng bộ: {pendingSyncCount}
            </span>
          )}
        </div>
        <div>
          {pendingSyncCount > 0 && isOnline && (
            <button
              data-testid="btn-sync-now"
              onClick={() => {
                void handleSyncNow();
              }}
              style={{
                padding: '8px 16px',
                background: '#1a73e8',
                color: 'white',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Đồng bộ ngay ({pendingSyncCount})
            </button>
          )}
        </div>
      </div>

      {statusMessage && (
        <div
          data-testid="status-message"
          style={{
            padding: 12,
            background: '#e8f0fe',
            borderRadius: 4,
            marginBottom: 16,
            color: '#1a73e8',
          }}
        >
          {statusMessage}
        </div>
      )}

      {/* Inspection selector */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
          Chọn Phiếu nghiệm thu:
        </label>
        <select
          data-testid="inspection-select"
          value={activeInspection?.id ?? ''}
          onChange={(e) => {
            const found = inspections.find((i) => i.id === e.target.value);
            if (found) setActiveInspection(found);
          }}
          style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
        >
          {inspections.map((insp) => (
            <option key={insp.id} value={insp.id}>
              [{insp.code}] {insp.title} ({insp.status})
            </option>
          ))}
        </select>
      </div>

      {/* Checklist items */}
      <div
        className="checklist-table-card"
        style={{ border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' }}
      >
        <div style={{ background: '#f1f3f4', padding: '12px 16px', fontWeight: 'bold' }}>
          Hạng mục Kiểm tra Hiện trường
        </div>
        <div style={{ padding: 16 }}>
          {[
            { key: 'rebar_diameter', title: 'Đường kính và chủng loại thép' },
            { key: 'rebar_spacing', title: 'Khoảng cách cốt thép sàn' },
            { key: 'concrete_cover', title: 'Chiều dày lớp bê tông bảo vệ' },
            { key: 'formwork_cleanliness', title: 'Vệ sinh đáy cốp pha trước khi đổ' },
          ].map((item) => (
            <div
              key={item.key}
              data-testid={`checklist-row-${item.key}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <span style={{ fontSize: 16 }}>{item.title}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  data-testid={`btn-pass-${item.key}`}
                  onClick={() => handleResultToggle(item.key, 'Pass')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 4,
                    border: '1px solid #137333',
                    background: checklistResults[item.key] === 'Pass' ? '#137333' : '#fff',
                    color: checklistResults[item.key] === 'Pass' ? '#fff' : '#137333',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  ĐẠT
                </button>
                <button
                  data-testid={`btn-fail-${item.key}`}
                  onClick={() => handleResultToggle(item.key, 'Fail')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 4,
                    border: '1px solid #c5221f',
                    background: checklistResults[item.key] === 'Fail' ? '#c5221f' : '#fff',
                    color: checklistResults[item.key] === 'Fail' ? '#fff' : '#c5221f',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  K.ĐẠT
                </button>
                <button
                  data-testid={`btn-na-${item.key}`}
                  onClick={() => handleResultToggle(item.key, 'NA')}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 4,
                    border: '1px solid #5f6368',
                    background: checklistResults[item.key] === 'NA' ? '#5f6368' : '#fff',
                    color: checklistResults[item.key] === 'NA' ? '#fff' : '#5f6368',
                    cursor: 'pointer',
                  }}
                >
                  K/A
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action footer */}
      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <button
          data-testid="btn-save-inspection"
          onClick={() => {
            void handleSaveInspection();
          }}
          style={{
            padding: '12px 24px',
            fontSize: 16,
            fontWeight: 'bold',
            background: '#1a73e8',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Lưu Phiếu Nghiệm Thu
        </button>
      </div>
    </div>
  );
}
