import React, { useState, useRef, useEffect } from 'react';
import type { VinopsApiClient, DailyLog } from './api.js';

export type DailyLogSheetProps = {
  projectId: string;
  client: VinopsApiClient;
  initialLog: DailyLog;
  onRefresh?: () => Promise<void>;
};

export function DailyLogSheet({
  client,
  initialLog,
  onRefresh,
}: DailyLogSheetProps): React.JSX.Element {
  const [log, setLog] = useState<DailyLog>(initialLog);
  const [workSummary, setWorkSummary] = useState(initialLog.workSummary ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const smCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const tvgsCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingSm, setIsDrawingSm] = useState(false);
  const [isDrawingTvgs, setIsDrawingTvgs] = useState(false);

  const isFrozen = log.status === 'Confirmed';

  useEffect(() => {
    setLog(initialLog);
    setWorkSummary(initialLog.workSummary ?? '');
  }, [initialLog]);

  const startDrawing = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    setIsDrawing: (val: boolean) => void,
  ) => {
    if (isFrozen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0]!.clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0]!.clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
    canvasRef: React.RefObject<HTMLCanvasElement | null>,
    isDrawing: boolean,
  ) => {
    if (!isDrawing || isFrozen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0]!.clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0]!.clientY - rect.top : e.clientY - rect.top;

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = (setIsDrawing: (val: boolean) => void) => {
    setIsDrawing(false);
  };

  const handleCrawlWeather = async () => {
    if (isFrozen) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await client.crawlDailyWeather(log.id, { lat: 21.0285, lng: 105.8542 });
      setLog(updated);
      setMessage('Đã tự động lấy dữ liệu thời tiết qua GPS.');
      if (onRefresh) await onRefresh();
    } catch (err: unknown) {
      setMessage(`Lỗi lấy thời tiết: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSummary = async () => {
    if (isFrozen) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await client.updateDailyLog(log.id, { work_summary: workSummary });
      setLog(updated);
      setMessage('Đã lưu nội dung nhật ký.');
      if (onRefresh) await onRefresh();
    } catch (err: unknown) {
      setMessage(`Lỗi lưu: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSignSiteManager = async () => {
    if (isFrozen) return;
    const canvas = smCanvasRef.current;
    const sigData = canvas ? canvas.toDataURL('image/png') : 'data:image/png;base64,sig_sm';
    setSaving(true);
    try {
      const updated = await client.signDailyLogSiteManager(log.id, sigData);
      setLog(updated);
      setMessage('Chỉ huy trưởng đã ký xác nhận nhật ký.');
      if (onRefresh) await onRefresh();
    } catch (err: unknown) {
      setMessage(`Lỗi ký: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSignSupervisor = async () => {
    if (isFrozen) return;
    const canvas = tvgsCanvasRef.current;
    const sigData = canvas ? canvas.toDataURL('image/png') : 'data:image/png;base64,sig_tvgs';
    setSaving(true);
    try {
      const updated = await client.signDailyLogSupervisor(log.id, sigData);
      setLog(updated);
      setMessage('Tư vấn giám sát đã ký xác nhận nhật ký.');
      if (onRefresh) await onRefresh();
    } catch (err: unknown) {
      setMessage(`Lỗi ký: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="daily-log-sheet-container"
      data-testid="daily-log-sheet"
      style={{ padding: 16 }}
    >
      {/* Title & Status */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <div>
          <h2>Nhật ký Thi công Điện tử</h2>
          <div style={{ color: '#666', fontSize: 14 }}>
            Ngày: <strong>{log.logDate}</strong> | Ca: <strong>{log.shiftCode}</strong> | Gói thầu:{' '}
            {log.contractPackageId}
          </div>
        </div>
        <div>
          <span
            data-testid="daily-log-status"
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              fontWeight: 'bold',
              fontSize: 14,
              background:
                log.status === 'Confirmed'
                  ? '#e6f4ea'
                  : log.status === 'Submitted'
                    ? '#feefe3'
                    : '#f1f3f4',
              color:
                log.status === 'Confirmed'
                  ? '#137333'
                  : log.status === 'Submitted'
                    ? '#b06000'
                    : '#5f6368',
            }}
          >
            {log.status === 'Confirmed'
              ? '🔒 ĐÃ KHÓA (CONFIRMED)'
              : log.status === 'Submitted'
                ? 'CHỜ DUYỆT (SUBMITTED)'
                : 'BẢN NHÁP (DRAFT)'}
          </span>
        </div>
      </div>

      {message && (
        <div
          data-testid="log-message"
          style={{
            padding: 12,
            borderRadius: 4,
            background: '#e8f0fe',
            color: '#1a73e8',
            marginBottom: 16,
          }}
        >
          {message}
        </div>
      )}

      {/* Weather Section */}
      <div
        className="card-section"
        style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>1. Diễn biến Thời tiết</h3>
          <button
            data-testid="btn-crawl-weather"
            disabled={isFrozen || saving}
            onClick={() => {
              void handleCrawlWeather();
            }}
            style={{
              padding: '6px 12px',
              background: isFrozen ? '#ccc' : '#1a73e8',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              cursor: isFrozen ? 'not-allowed' : 'pointer',
            }}
          >
            Lấy thời tiết GPS
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {['morning', 'noon', 'afternoon'].map((window) => {
            const w = (log.weather ?? []).find((item) => item.timeOfDay === window);
            return (
              <div
                key={window}
                data-testid={`weather-box-${window}`}
                style={{
                  padding: 12,
                  background: '#f8f9fa',
                  borderRadius: 6,
                  border: '1px solid #eee',
                }}
              >
                <div style={{ fontWeight: 'bold', textTransform: 'capitalize', marginBottom: 4 }}>
                  {window === 'morning' ? 'Sáng' : window === 'noon' ? 'Trưa' : 'Chiều'}
                </div>
                {w ? (
                  <div>
                    <div>Nhiệt độ: {w.temperatureC}°C</div>
                    <div>Thời tiết: {w.weatherCondition}</div>
                    <div>Mưa: {w.rainfallMm} mm</div>
                    <div style={{ fontSize: 11, color: '#888' }}>Nguồn: {w.source}</div>
                  </div>
                ) : (
                  <div style={{ color: '#999', fontSize: 13 }}>Chưa có dữ liệu</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Work Summary */}
      <div
        className="card-section"
        style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16, marginBottom: 16 }}
      >
        <h3 style={{ margin: '0 0 12px 0' }}>2. Nội dung Công việc & Khối lượng thực hiện</h3>
        <textarea
          data-testid="input-work-summary"
          disabled={isFrozen}
          value={workSummary}
          onChange={(e) => setWorkSummary(e.target.value)}
          rows={4}
          style={{
            width: '100%',
            padding: 8,
            borderRadius: 4,
            border: '1px solid #ccc',
            boxSizing: 'border-box',
          }}
          placeholder="Mô tả chi tiết khối lượng, công việc đã triển khai trong ngày..."
        />
        {!isFrozen && (
          <div style={{ marginTop: 8, textAlign: 'right' }}>
            <button
              data-testid="btn-save-summary"
              disabled={saving}
              onClick={() => {
                void handleSaveSummary();
              }}
              style={{
                padding: '6px 16px',
                background: '#1a73e8',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Lưu nội dung
            </button>
          </div>
        )}
      </div>

      {/* Manpower & Equipment Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px 0' }}>3. Nhân lực thi công</h3>
          {(log.manpower ?? []).length > 0 ? (
            <ul data-testid="manpower-list" style={{ margin: 0, paddingLeft: 20 }}>
              {(log.manpower ?? []).map((m) => (
                <li key={m.id}>
                  {m.tradeOrSubcontractor}: <strong>{m.headcount}</strong> người ({m.hoursWorked}h)
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ color: '#888' }}>Chưa có nhân lực ghi nhận.</div>
          )}
        </div>

        <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px 0' }}>4. Thiết bị thi công</h3>
          {(log.equipment ?? []).length > 0 ? (
            <ul data-testid="equipment-list" style={{ margin: 0, paddingLeft: 20 }}>
              {(log.equipment ?? []).map((e) => (
                <li key={e.id}>
                  {e.equipmentName}: <strong>{e.quantity}</strong> ({e.operationalStatus})
                </li>
              ))}
            </ul>
          ) : (
            <div style={{ color: '#888' }}>Chưa có thiết bị ghi nhận.</div>
          )}
        </div>
      </div>

      {/* Two-party Signature Section (Canvas Pad) */}
      <div
        className="card-section"
        style={{ border: '1px solid #e0e0e0', borderRadius: 8, padding: 16 }}
      >
        <h3 style={{ margin: '0 0 16px 0' }}>
          5. Ký xác nhận 2 bên (Chỉ huy trưởng & Tư vấn Giám sát)
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Site Manager Signature */}
          <div
            data-testid="signature-box-sm"
            style={{ border: '1px dashed #ccc', borderRadius: 6, padding: 12, textAlign: 'center' }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
              Đại diện Nhà thầu (Chỉ huy trưởng)
            </div>
            {log.siteManagerSignedBy ? (
              <div style={{ color: '#137333', padding: 24 }}>
                ✓ Đã ký điện tử bởi {log.siteManagerSignedBy}
              </div>
            ) : (
              <div>
                <canvas
                  ref={smCanvasRef}
                  data-testid="canvas-sm"
                  width={280}
                  height={120}
                  style={{ border: '1px solid #ddd', background: '#fff', touchAction: 'none' }}
                  onMouseDown={(e) => startDrawing(e, smCanvasRef, setIsDrawingSm)}
                  onMouseMove={(e) => draw(e, smCanvasRef, isDrawingSm)}
                  onMouseUp={() => stopDrawing(setIsDrawingSm)}
                  onTouchStart={(e) => startDrawing(e, smCanvasRef, setIsDrawingSm)}
                  onTouchMove={(e) => draw(e, smCanvasRef, isDrawingSm)}
                  onTouchEnd={() => stopDrawing(setIsDrawingSm)}
                />
                {!isFrozen && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      data-testid="btn-sign-sm"
                      disabled={saving}
                      onClick={() => {
                        void handleSignSiteManager();
                      }}
                      style={{
                        padding: '6px 14px',
                        background: '#137333',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Ký xác nhận (CHT)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Supervisor Signature */}
          <div
            data-testid="signature-box-tvgs"
            style={{ border: '1px dashed #ccc', borderRadius: 6, padding: 12, textAlign: 'center' }}
          >
            <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
              Đại diện Tư vấn Giám sát (TVGS)
            </div>
            {log.supervisorSignedBy ? (
              <div style={{ color: '#137333', padding: 24 }}>
                ✓ Đã ký điện tử bởi {log.supervisorSignedBy}
              </div>
            ) : (
              <div>
                <canvas
                  ref={tvgsCanvasRef}
                  data-testid="canvas-tvgs"
                  width={280}
                  height={120}
                  style={{ border: '1px solid #ddd', background: '#fff', touchAction: 'none' }}
                  onMouseDown={(e) => startDrawing(e, tvgsCanvasRef, setIsDrawingTvgs)}
                  onMouseMove={(e) => draw(e, tvgsCanvasRef, isDrawingTvgs)}
                  onMouseUp={() => stopDrawing(setIsDrawingTvgs)}
                  onTouchStart={(e) => startDrawing(e, tvgsCanvasRef, setIsDrawingTvgs)}
                  onTouchMove={(e) => draw(e, tvgsCanvasRef, isDrawingTvgs)}
                  onTouchEnd={() => stopDrawing(setIsDrawingTvgs)}
                />
                {!isFrozen && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      data-testid="btn-sign-tvgs"
                      disabled={saving}
                      onClick={() => {
                        void handleSignSupervisor();
                      }}
                      style={{
                        padding: '6px 14px',
                        background: '#137333',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      Ký xác nhận (TVGS)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
