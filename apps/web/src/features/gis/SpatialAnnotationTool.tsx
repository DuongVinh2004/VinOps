import React, { useState } from 'react';

export type SpatialAnnotationItem = {
  id: string;
  geometryType: 'point' | 'linestring' | 'polygon';
  label: string;
  entityType?: 'field_issue' | 'inspection' | 'survey_point' | 'note' | undefined;
  entityId?: string | undefined;
  color?: string | undefined;
  coordinates?: unknown;
  colorHex?: string | undefined;
  linkedEntityType?: string | undefined;
};

export type SpatialAnnotationToolProps = {
  projectId: string;
  annotations: SpatialAnnotationItem[];
  onSaveAnnotation?: (annotation: Omit<SpatialAnnotationItem, 'id'>) => Promise<void>;
};

export function SpatialAnnotationTool({
  projectId,
  annotations,
  onSaveAnnotation,
}: SpatialAnnotationToolProps): React.JSX.Element {
  const [activeTool, setActiveTool] = useState<'point' | 'linestring' | 'polygon' | null>(null);
  const [label, setLabel] = useState('');
  const [entityType, setEntityType] = useState<'field_issue' | 'inspection' | 'note'>(
    'field_issue',
  );
  const [color, setColor] = useState('#E63946'); // Default red
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTool || !label.trim() || !onSaveAnnotation) return;

    setIsSubmitting(true);
    setStatusMsg(null);

    try {
      // Mock coordinates based on tool type
      const coordinates =
        activeTool === 'point'
          ? [105.85, 21.02] // [lng, lat]
          : activeTool === 'linestring'
            ? [
                [105.85, 21.02],
                [105.855, 21.025],
              ]
            : [
                [
                  [105.85, 21.02],
                  [105.855, 21.02],
                  [105.855, 21.025],
                  [105.85, 21.025],
                  [105.85, 21.02],
                ],
              ];

      await onSaveAnnotation({
        geometryType: activeTool,
        coordinates,
        label: label.trim(),
        colorHex: color,
        linkedEntityType: entityType,
      });

      setStatusMsg('Đã lưu chú thích thành công!');
      setLabel('');
      setActiveTool(null);
    } catch {
      setStatusMsg('Lỗi khi lưu chú thích!');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      data-project-id={projectId}
      style={{
        backgroundColor: '#1E293B',
        color: '#F8FAFC',
        padding: '16px',
        borderRadius: '8px',
        border: '1px solid #334155',
        width: '100%',
        maxWidth: '380px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      }}
    >
      <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 600 }}>
        Công cụ Chú thích Không gian GIS
      </h3>

      {/* Drawing Mode Selector */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {(['point', 'linestring', 'polygon'] as const).map((tool) => (
          <button
            key={tool}
            type="button"
            onClick={() => setActiveTool(activeTool === tool ? null : tool)}
            style={{
              flex: 1,
              padding: '8px 4px',
              backgroundColor: activeTool === tool ? '#2563EB' : '#334155',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          >
            {tool === 'point' ? '📍 Điểm' : tool === 'linestring' ? '📏 Đoạn' : '⬡ Vùng'}
          </button>
        ))}
      </div>

      {activeTool && (
        <form
          onSubmit={(e) => {
            void handleSave(e);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
        >
          <div>
            <label
              style={{ fontSize: '12px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}
            >
              Tên chú thích / Sự vụ:
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="VD: Nứt sụt taluy K15+200..."
              style={inputStyle}
              required
            />
          </div>

          <div>
            <label
              style={{ fontSize: '12px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}
            >
              Liên kết Nghiệp vụ:
            </label>
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as typeof entityType)}
              style={inputStyle}
            >
              <option value="field_issue">Sự vụ Hiện trường (Field Issue)</option>
              <option value="inspection">Biên bản Nghiệm thu (Inspection)</option>
              <option value="note">Ghi chú Trắc địa (Note)</option>
            </select>
          </div>

          <div>
            <label
              style={{ fontSize: '12px', color: '#94A3B8', display: 'block', marginBottom: '4px' }}
            >
              Màu sắc đánh dấu:
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {['#E63946', '#F4A261', '#E9C46A', '#2A9D8F', '#264653'].map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: c,
                    border: color === c ? '2px solid #FFFFFF' : 'none',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={!label.trim() || isSubmitting}
            style={{
              marginTop: '6px',
              padding: '8px 12px',
              backgroundColor: '#10B981',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: label.trim() && !isSubmitting ? 'pointer' : 'not-allowed',
            }}
          >
            {isSubmitting ? 'Đang lưu...' : 'Lưu Chú thích'}
          </button>
        </form>
      )}

      {statusMsg && (
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#38BDF8' }}>{statusMsg}</div>
      )}

      {/* Existing Annotations List */}
      <div style={{ marginTop: '16px', borderTop: '1px solid #334155', paddingTop: '12px' }}>
        <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '8px' }}>
          Đã đánh dấu ({annotations.length}):
        </div>
        <div
          style={{
            maxHeight: '180px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {annotations.map((ann) => (
            <div
              key={ann.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                backgroundColor: '#0F172A',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: ann.color,
                }}
              />
              <div
                style={{
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {ann.label}
              </div>
              <span style={{ fontSize: '10px', color: '#64748B' }}>{ann.geometryType}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  backgroundColor: '#0F172A',
  border: '1px solid #334155',
  borderRadius: '4px',
  color: '#F8FAFC',
  fontSize: '12px',
  outline: 'none',
  boxSizing: 'border-box',
};
