import { useCallback, useEffect, useRef, useState } from 'react';
import { useRealtimeSocket, type RealtimeEvent } from '../../providers/RealtimeSocketProvider.js';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  severity: 'normal' | 'high' | 'critical';
  timestamp: string;
}

function playCriticalAlertSound(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3); // A4

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // AudioContext blocked by browser policy
  }
}

export function RealtimeNotificationBell() {
  const { lastEvent, status } = useRealtimeSocket();
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<RealtimeEvent[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = toastTimersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback(
    (toast: ToastItem) => {
      setToasts((prev) => [...prev, toast]);

      if (toast.severity === 'critical') {
        playCriticalAlertSound();
      }

      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => {
        removeToast(toast.id);
      }, 5000);

      toastTimersRef.current.set(toast.id, timer);
    },
    [removeToast],
  );

  useEffect(() => {
    if (!lastEvent) return;

    setNotifications((prev) => [lastEvent, ...prev].slice(0, 20));
    setUnreadCount((c) => c + 1);

    const eventData = (lastEvent.data || {}) as Record<string, unknown>;
    const severity =
      eventData['severity'] === 'Critical'
        ? 'critical'
        : eventData['severity'] === 'High'
          ? 'high'
          : 'normal';

    const title =
      lastEvent.channel === 'issues'
        ? 'Field Issue Updated'
        : lastEvent.channel === 'rfis'
          ? 'RFI Status Changed'
          : lastEvent.channel === 'inspections'
            ? 'Inspection Updated'
            : 'New Notification';

    const code = typeof eventData['code'] === 'string' ? eventData['code'] : undefined;
    const message = code
      ? `${code}: ${lastEvent.action}`
      : `Event received on ${lastEvent.channel}`;

    addToast({
      id: lastEvent.eventId || Math.random().toString(),
      title,
      message,
      severity,
      timestamp: lastEvent.timestamp || new Date().toISOString(),
    });
  }, [lastEvent, addToast]);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
    if (!isOpen) {
      setUnreadCount(0);
    }
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={handleToggle}
        aria-label="Realtime Notifications"
        style={{
          position: 'relative',
          padding: '8px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '50%',
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span
            data-testid="notification-badge"
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              background: '#dc2626',
              color: '#ffffff',
              borderRadius: '9999px',
              padding: '2px 6px',
              fontSize: '11px',
              fontWeight: 'bold',
              minWidth: '18px',
              textAlign: 'center',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}

        {/* Live Status Dot */}
        <span
          style={{
            position: 'absolute',
            bottom: '4px',
            right: '4px',
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background:
              status === 'connected' ? '#16a34a' : status === 'connecting' ? '#ca8a04' : '#9ca3af',
          }}
          title={`Status: ${status}`}
        />
      </button>

      {/* Notifications Dropdown Popover */}
      {isOpen && (
        <div
          data-testid="notification-popover"
          style={{
            position: 'absolute',
            right: 0,
            marginTop: '8px',
            width: '320px',
            maxHeight: '400px',
            background: '#ffffff',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            borderRadius: '8px',
            border: '1px solid #e5e7eb',
            overflowY: 'auto',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid #f3f4f6',
              fontWeight: 600,
              fontSize: '14px',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Thông báo Thời gian thực</span>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              {status === 'connected' ? '● Trực tuyến' : '○ Ngoại tuyến'}
            </span>
          </div>

          {notifications.length === 0 ? (
            <div
              style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}
            >
              Chưa có thông báo mới
            </div>
          ) : (
            notifications.map((notif, index) => (
              <div
                key={notif.eventId || index}
                style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid #f9fafb',
                  fontSize: '13px',
                }}
              >
                <div style={{ fontWeight: 500, color: '#111827' }}>{notif.type}</div>
                <div style={{ color: '#4b5563', fontSize: '12px', marginTop: '2px' }}>
                  Kênh: {notif.channel} | Thao tác: {notif.action}
                </div>
                <div style={{ color: '#9ca3af', fontSize: '11px', marginTop: '4px' }}>
                  {new Date(notif.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Toast Popups Container */}
      <div
        data-testid="toast-container"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          zIndex: 9999,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            style={{
              pointerEvents: 'auto',
              background: toast.severity === 'critical' ? '#fef2f2' : '#ffffff',
              borderLeft: `4px solid ${
                toast.severity === 'critical'
                  ? '#dc2626'
                  : toast.severity === 'high'
                    ? '#f59e0b'
                    : '#2563eb'
              }`,
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              borderRadius: '6px',
              padding: '12px 16px',
              width: '300px',
              border: '1px solid #e5e7eb',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontWeight: 600,
                fontSize: '13px',
                color: toast.severity === 'critical' ? '#991b1b' : '#1f2937',
              }}
            >
              <span>{toast.title}</span>
              <button
                type="button"
                onClick={() => removeToast(toast.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9ca3af',
                  fontSize: '14px',
                }}
              >
                &times;
              </button>
            </div>
            <div style={{ fontSize: '12px', color: '#4b5563', marginTop: '4px' }}>
              {toast.message}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
