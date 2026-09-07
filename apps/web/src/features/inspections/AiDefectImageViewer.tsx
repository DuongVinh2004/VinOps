import React, { useRef, useEffect, useState, useCallback } from 'react';

export type DefectBox = {
  id: string;
  type: string;
  confidence: number;
  bbox: {
    x: number; // normalized 0-1
    y: number;
    w: number;
    h: number;
  };
  reviewStatus: 'auto_tagged' | 'pending_review' | 'confirmed' | 'rejected' | 'false_positive';
};

export type AiDefectImageViewerProps = {
  imageUrl: string;
  detections: DefectBox[];
  onReview?: (detectionId: string, status: 'confirmed' | 'rejected' | 'false_positive') => void;
  readOnly?: boolean;
};

export function getDetectionColor(type: string): { stroke: string; fill: string } {
  switch (type) {
    case 'crack':
    case 'rebar_exposure':
      return { stroke: '#E63946', fill: 'rgba(230, 57, 70, 0.2)' }; // Red: critical
    case 'honeycombing':
    case 'formwork_defect':
      return { stroke: '#F4A261', fill: 'rgba(244, 162, 97, 0.2)' }; // Orange
    case 'ppe_violation_hardhat':
    case 'ppe_violation_vest':
    case 'ppe_violation_harness':
    default:
      return { stroke: '#E9C46A', fill: 'rgba(233, 196, 106, 0.2)' }; // Yellow
  }
}

export function AiDefectImageViewer({
  imageUrl,
  detections,
  onReview,
  readOnly = false,
}: AiDefectImageViewerProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [selectedDetection, setSelectedDetection] = useState<DefectBox | null>(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });

  // Handle canvas rendering
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const det of detections) {
      const colors = getDetectionColor(det.type);
      const x = det.bbox.x * canvas.width;
      const y = det.bbox.y * canvas.height;
      const w = det.bbox.w * canvas.width;
      const h = det.bbox.h * canvas.height;

      // Draw box rectangle
      ctx.strokeStyle = colors.stroke;
      ctx.lineWidth = selectedDetection?.id === det.id ? 3 : 2;
      ctx.fillStyle = colors.fill;

      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      // Label badge
      const label = `${det.type} (${(det.confidence * 100).toFixed(0)}%)`;
      ctx.font = '12px system-ui, -apple-system, sans-serif';
      const textMetrics = ctx.measureText(label);
      const textWidth = textMetrics.width;

      ctx.fillStyle = colors.stroke;
      ctx.fillRect(x, Math.max(0, y - 20), textWidth + 8, 20);

      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(label, x + 4, Math.max(14, y - 5));
    }
  }, [detections, selectedDetection]);

  useEffect(() => {
    if (imageLoaded) {
      renderCanvas();
    }
  }, [imageLoaded, renderCanvas]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = (e.clientX - rect.left) / rect.width;
    const clickY = (e.clientY - rect.top) / rect.height;

    // Find clicked detection
    const clicked = detections.find((d) => {
      return (
        clickX >= d.bbox.x &&
        clickX <= d.bbox.x + d.bbox.w &&
        clickY >= d.bbox.y &&
        clickY <= d.bbox.y + d.bbox.h
      );
    });

    setSelectedDetection(clicked ?? null);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-block',
        width: '100%',
        maxWidth: '800px',
        backgroundColor: '#1E1E1E',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <img
        src={imageUrl}
        alt="Site Inspection Defect Inspection"
        onLoad={(e) => {
          const img = e.currentTarget;
          setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          setImageLoaded(true);
        }}
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />

      <canvas
        ref={canvasRef}
        width={imageDimensions.width || 800}
        height={imageDimensions.height || 600}
        onClick={handleCanvasClick}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          cursor: 'pointer',
        }}
      />

      {/* Detail & Review Popup */}
      {selectedDetection && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            left: '16px',
            right: '16px',
            backgroundColor: 'rgba(25, 25, 25, 0.95)',
            border: '1px solid #444',
            borderRadius: '8px',
            padding: '12px 16px',
            color: '#FFF',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          }}
        >
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px', textTransform: 'capitalize' }}>
              {selectedDetection.type.replace('_', ' ')}
            </div>
            <div style={{ fontSize: '12px', color: '#BBB', marginTop: '2px' }}>
              Độ tin cậy: {(selectedDetection.confidence * 100).toFixed(1)}% | Trạng thái:{' '}
              {selectedDetection.reviewStatus}
            </div>
          </div>

          {!readOnly && onReview && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => onReview(selectedDetection.id, 'confirmed')}
                style={{
                  backgroundColor: '#2A9D8F',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Xác nhận
              </button>
              <button
                type="button"
                onClick={() => onReview(selectedDetection.id, 'rejected')}
                style={{
                  backgroundColor: '#E76F51',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Bác bỏ
              </button>
              <button
                type="button"
                onClick={() => onReview(selectedDetection.id, 'false_positive')}
                style={{
                  backgroundColor: '#6C757D',
                  color: '#FFF',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '6px 12px',
                  fontSize: '12px',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Báo sai
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
