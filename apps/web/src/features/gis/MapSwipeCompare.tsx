import React, { useState, useRef, useCallback } from 'react';

export type SwipeLayerInfo = {
  id: string;
  title: string;
  date: string;
  url?: string;
  type: 'orthophoto' | 'cad';
};

export type MapSwipeCompareProps = {
  leftLayer: SwipeLayerInfo;
  rightLayer: SwipeLayerInfo;
  initialDividerPercent?: number;
};

export function MapSwipeCompare({
  leftLayer,
  rightLayer,
  initialDividerPercent = 50,
}: MapSwipeCompareProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dividerPercent, setDividerPercent] = useState(initialDividerPercent);
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState(16);
  const [center] = useState<[number, number]>([106.7821, 10.8354]);

  const handlePointerDown = () => setIsDragging(true);
  const handlePointerUp = () => setIsDragging(false);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(5, Math.min(95, (x / rect.width) * 100));
      setDividerPercent(pct);
    },
    [isDragging],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        width: '100%',
        maxWidth: '1000px',
      }}
    >
      {/* Header Info */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          padding: '8px 12px',
          backgroundColor: '#1E293B',
          borderRadius: '6px',
          color: '#F8FAFC',
          fontSize: '13px',
        }}
      >
        <div>
          👈 <strong>Bên trái (Cũ):</strong> {leftLayer.title} ({leftLayer.date})
        </div>
        <div>
          👉 <strong>Bên phải (Mới):</strong> {rightLayer.title} ({rightLayer.date})
        </div>
      </div>

      {/* Swipe Split Viewport Container */}
      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        style={{
          position: 'relative',
          width: '100%',
          height: '550px',
          backgroundColor: '#0F172A',
          borderRadius: '8px',
          overflow: 'hidden',
          userSelect: 'none',
          cursor: isDragging ? 'ew-resize' : 'default',
        }}
      >
        {/* Right Layer (Background full width) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: '#1A365D',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#90CDF4',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '28px' }}>🚜</div>
            <div style={{ fontWeight: 600, marginTop: '8px' }}>{rightLayer.title}</div>
            <div style={{ fontSize: '12px', opacity: 0.8 }}>
              Hiện trạng thi công: {rightLayer.date}
            </div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>
              Zoom: {zoom} | Tọa độ: {center.join(', ')}
            </div>
          </div>
        </div>

        {/* Left Layer (Clipped via dividerPercent) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: '#2D3748',
            clipPath: `inset(0 ${100 - dividerPercent}% 0 0)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#CBD5E0',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '28px' }}>🏗️</div>
            <div style={{ fontWeight: 600, marginTop: '8px' }}>{leftLayer.title}</div>
            <div style={{ fontSize: '12px', opacity: 0.8 }}>
              Hiện trạng thi công: {leftLayer.date}
            </div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>
              Zoom: {zoom} | Tọa độ: {center.join(', ')}
            </div>
          </div>
        </div>

        {/* Divider Slider Handle */}
        <div
          onPointerDown={handlePointerDown}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${dividerPercent}%`,
            width: '4px',
            backgroundColor: '#FFFFFF',
            cursor: 'ew-resize',
            transform: 'translateX(-50%)',
            boxShadow: '0 0 10px rgba(0,0,0,0.5)',
            zIndex: 20,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '32px',
              height: '32px',
              backgroundColor: '#FFFFFF',
              color: '#0F172A',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
              fontSize: '12px',
              fontWeight: 'bold',
            }}
          >
            ◀▶
          </div>
        </div>

        {/* Zoom Controls */}
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            display: 'flex',
            gap: '6px',
            zIndex: 30,
          }}
        >
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(22, z + 1))}
            style={btnStyle}
          >
            +
          </button>
          <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 1))} style={btnStyle}>
            −
          </button>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  width: '30px',
  height: '30px',
  backgroundColor: '#1E293B',
  color: '#FFFFFF',
  border: '1px solid #475569',
  borderRadius: '4px',
  cursor: 'pointer',
  fontWeight: 'bold',
};
