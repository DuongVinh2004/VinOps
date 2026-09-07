import React, { useState, useRef } from 'react';

export type MapLibreContainerProps = {
  projectId: string;
  center?: [number, number]; // [lng, lat]
  zoom?: number;
  pitch?: number;
  bearing?: number;
  baseMapStyle?: 'satellite' | 'streets' | 'topo' | 'dark' | 'hybrid';
  layers?: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    sourceUrl?: string;
    visible?: boolean;
    opacity?: number;
  }>;
  onAnnotationClick?: (annotationId: string) => void;
};

export function MapLibreContainer({
  projectId,
  center = [106.7821, 10.8354],
  zoom = 15,
  pitch = 0,
  bearing = 0,
  baseMapStyle = 'satellite',
  layers = [],
  onAnnotationClick,
}: MapLibreContainerProps): React.JSX.Element {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const [currentZoom, setCurrentZoom] = useState(zoom);
  const [currentPitch, setCurrentPitch] = useState(pitch);
  const [currentBearing, setCurrentBearing] = useState(bearing);
  const [activeStyle, setActiveStyle] = useState(baseMapStyle);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [statusText, setStatusText] = useState<string>('Bản đồ GIS sẵn sàng');

  // GPS Geolocation (Capacitor / Web)
  const handleGeolocate = () => {
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      setStatusText('Đang định vị GPS hiện trường...');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
          setUserLocation(coords);
          setStatusText(`Đã xác định vị trí: ${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}`);
        },
        (err) => {
          setStatusText(`Lỗi GPS: ${err.message}`);
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    } else {
      setStatusText('Thiết bị không hỗ trợ Geolocation API');
    }
  };

  const handleZoomIn = () => setCurrentZoom((z) => Math.min(22, z + 1));
  const handleZoomOut = () => setCurrentZoom((z) => Math.max(1, z - 1));
  const handleTogglePitch = () => setCurrentPitch((p) => (p === 0 ? 45 : 0));
  const handleResetNorth = () => setCurrentBearing(0);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '600px',
        backgroundColor: '#0F172A',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid #334155',
      }}
    >
      {/* Map Viewport Area */}
      <div
        ref={mapContainerRef}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundImage:
            activeStyle === 'satellite'
              ? 'radial-gradient(circle at center, #1E293B 0%, #0F172A 100%)'
              : 'radial-gradient(circle at center, #334155 0%, #1E293B 100%)',
        }}
      >
        {/* Visual Map Canvas Representation */}
        <div style={{ textAlign: 'center', color: '#94A3B8' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🗺️</div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: '#E2E8F0' }}>
            MapLibre GL WebGL Canvas (EPSG:3857)
          </div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>
            Tâm: [{center[0].toFixed(4)}, {center[1].toFixed(4)}] | Zoom: {currentZoom} | Pitch:{' '}
            {currentPitch}° | Góc: {currentBearing}°
          </div>
          {userLocation && (
            <div style={{ fontSize: '12px', color: '#10B981', marginTop: '4px' }}>
              📍 Vị trí kỹ sư: [{userLocation[0].toFixed(5)}, {userLocation[1].toFixed(5)}]
            </div>
          )}
        </div>

        {/* Mock Orthophoto Layer Overlay */}
        {layers
          .filter((l) => l.visible !== false)
          .map((l) => (
            <div
              key={l.id}
              onClick={() => onAnnotationClick?.(l.id)}
              style={{
                position: 'absolute',
                top: '40%',
                left: '45%',
                padding: '6px 10px',
                backgroundColor: 'rgba(37, 99, 235, 0.85)',
                color: '#FFFFFF',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
                border: '1px solid #60A5FA',
              }}
            >
              📷 {l.name} ({l.code})
            </div>
          ))}
      </div>

      {/* Map Control Toolbar */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          right: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          zIndex: 10,
        }}
      >
        <button type="button" onClick={handleZoomIn} title="Phóng to" style={controlBtnStyle}>
          +
        </button>
        <button type="button" onClick={handleZoomOut} title="Thu nhỏ" style={controlBtnStyle}>
          −
        </button>
        <button
          type="button"
          onClick={handleTogglePitch}
          title="Góc nghiêng 3D"
          style={controlBtnStyle}
        >
          3D
        </button>
        <button
          type="button"
          onClick={handleResetNorth}
          title="Định hướng Bắc"
          style={controlBtnStyle}
        >
          🧭
        </button>
        <button
          type="button"
          onClick={handleGeolocate}
          title="Vị trí của tôi"
          style={{ ...controlBtnStyle, backgroundColor: '#059669', color: '#FFF' }}
        >
          📍
        </button>
      </div>

      {/* Layer Style Switcher */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          backgroundColor: 'rgba(15, 23, 42, 0.9)',
          padding: '6px 10px',
          borderRadius: '6px',
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          border: '1px solid #334155',
          fontSize: '12px',
          color: '#E2E8F0',
        }}
      >
        <span>Nền:</span>
        {(['satellite', 'streets', 'topo', 'dark', 'hybrid'] as const).map((style) => (
          <button
            key={style}
            type="button"
            onClick={() => setActiveStyle(style)}
            style={{
              background: activeStyle === style ? '#2563EB' : 'transparent',
              color: activeStyle === style ? '#FFFFFF' : '#94A3B8',
              border: 'none',
              padding: '2px 8px',
              borderRadius: '4px',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {style}
          </button>
        ))}
      </div>

      {/* Status Bar */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          padding: '4px 10px',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#94A3B8',
          border: '1px solid #334155',
        }}
      >
        {statusText} | Project: {projectId}
      </div>
    </div>
  );
}

const controlBtnStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  backgroundColor: '#1E293B',
  color: '#F8FAFC',
  border: '1px solid #475569',
  borderRadius: '4px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '14px',
  fontWeight: 'bold',
  cursor: 'pointer',
  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
};
