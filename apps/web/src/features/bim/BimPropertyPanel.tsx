import React, { useState, useMemo } from 'react';
import type {
  BimElementResponse,
  BimElementLinkResponse,
  BimElementLinkItem,
} from '@vinops/contracts';

export type BimLinkEntry = BimElementLinkResponse | BimElementLinkItem;

export interface BimPropertyPanelProps {
  element: BimElementResponse | null;
  links?: BimLinkEntry[] | undefined;
  loading?: boolean | undefined;
  onClose?: (() => void) | undefined;
  onFocusElement?: ((guid: string) => void) | undefined;
  onCreateIssueLink?: ((guid: string) => void) | undefined;
  onAddEntityLink?: ((guid: string, entityType: string, entityId: string) => void) | undefined;
}

export function BimPropertyPanel({
  element,
  links = [],
  loading = false,
  onClose,
  onFocusElement,
  onCreateIssueLink,
  onAddEntityLink,
}: BimPropertyPanelProps): React.JSX.Element | null {
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [newEntityType, setNewEntityType] = useState<string>('location_node');
  const [newEntityId, setNewEntityId] = useState<string>('');
  const [showAddLinkForm, setShowAddLinkForm] = useState<boolean>(false);

  // Group properties by Property Set
  const groupedProperties = useMemo(() => {
    if (!element || !element.properties) return {};
    const raw = element.properties as Record<string, unknown>;
    const groups: Record<string, Record<string, unknown>> = {};

    for (const [key, val] of Object.entries(raw)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        groups[key] = val as Record<string, unknown>;
      } else {
        if (!groups['General']) groups['General'] = {};
        groups['General'][key] = val;
      }
    }
    return groups;
  }, [element]);

  // Filter properties according to search input
  const filteredGroups = useMemo(() => {
    if (!filterQuery.trim()) return groupedProperties;
    const q = filterQuery.toLowerCase().trim();
    const result: Record<string, Record<string, unknown>> = {};

    for (const [psetName, props] of Object.entries(groupedProperties)) {
      const matchedProps: Record<string, unknown> = {};
      const psetMatched = psetName.toLowerCase().includes(q);

      for (const [propName, propVal] of Object.entries(props)) {
        const valStr = String(propVal).toLowerCase();
        if (psetMatched || propName.toLowerCase().includes(q) || valStr.includes(q)) {
          matchedProps[propName] = propVal;
        }
      }

      if (Object.keys(matchedProps).length > 0) {
        result[psetName] = matchedProps;
      }
    }
    return result;
  }, [groupedProperties, filterQuery]);

  if (!element) {
    return null;
  }

  const handleCopyGuid = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(element.ifcGuid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleAddLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEntityId.trim() || !onAddEntityLink) return;
    onAddEntityLink(element.ifcGuid, newEntityType, newEntityId.trim());
    setNewEntityId('');
    setShowAddLinkForm(false);
  };

  return (
    <aside
      role="complementary"
      aria-label="Thuộc tính cấu kiện BIM"
      style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        width: '380px',
        maxHeight: 'calc(100% - 32px)',
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(12px)',
        border: '1px solid #334155',
        borderRadius: '8px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        flexDirection: 'column',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        zIndex: 50,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #334155',
          backgroundColor: '#1e293b',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, marginRight: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: '4px',
                textTransform: 'uppercase',
              }}
            >
              {element.ifcType}
            </span>
            {element.storeyName && (
              <span
                style={{
                  backgroundColor: '#334155',
                  color: '#94a3b8',
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}
              >
                {element.storeyName}
              </span>
            )}
          </div>
          <h3
            style={{
              margin: '0 0 4px 0',
              fontSize: '16px',
              fontWeight: 600,
              color: '#ffffff',
              lineHeight: 1.3,
            }}
          >
            {element.name || 'Cấu kiện không tên'}
          </h3>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              color: '#94a3b8',
            }}
          >
            <span>GUID: {element.ifcGuid}</span>
            <button
              type="button"
              onClick={handleCopyGuid}
              title="Sao chép GUID"
              style={{
                background: 'none',
                border: 'none',
                color: copied ? '#10b981' : '#60a5fa',
                cursor: 'pointer',
                padding: '0 4px',
                fontSize: '11px',
              }}
            >
              {copied ? '✓ Đã sao chép' : '📋 Chép'}
            </button>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng thuộc tính"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '18px',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '4px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Action Buttons Toolbar */}
      <div
        style={{
          padding: '10px 16px',
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid #334155',
          backgroundColor: '#0f172a',
        }}
      >
        {onFocusElement && (
          <button
            type="button"
            onClick={() => onFocusElement(element.ifcGuid)}
            style={{
              flex: 1,
              backgroundColor: '#1e293b',
              border: '1px solid #475569',
              color: '#f8fafc',
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            🎯 Tiêu điểm
          </button>
        )}

        {onCreateIssueLink && (
          <button
            type="button"
            onClick={() => onCreateIssueLink(element.ifcGuid)}
            style={{
              flex: 1.2,
              backgroundColor: '#b45309',
              border: '1px solid #f59e0b',
              color: '#ffffff',
              padding: '6px 10px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
            }}
          >
            ⚠️ Tạo vấn đề (BCF)
          </button>
        )}
      </div>

      {/* Search Input */}
      <div style={{ padding: '8px 16px', borderBottom: '1px solid #1e293b' }}>
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Lọc thuộc tính (tên, giá trị, pset)..."
          aria-label="Lọc thuộc tính"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '4px',
            padding: '6px 10px',
            color: '#ffffff',
            fontSize: '12px',
            outline: 'none',
          }}
        />
      </div>

      {/* Content Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}
      >
        {loading && (
          <div style={{ textAlign: 'center', color: '#60a5fa', fontSize: '13px', padding: '16px' }}>
            Đang tải dữ liệu cấu kiện...
          </div>
        )}

        {/* Spatial Links Section */}
        <section aria-labelledby="bim-links-title">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}
          >
            <h4
              id="bim-links-title"
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#38bdf8',
              }}
            >
              Liên kết không gian ({links.length})
            </h4>
            {onAddEntityLink && !showAddLinkForm && (
              <button
                type="button"
                onClick={() => setShowAddLinkForm(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: '11px',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                + Thêm liên kết
              </button>
            )}
          </div>

          {showAddLinkForm && (
            <form
              onSubmit={handleAddLinkSubmit}
              style={{
                backgroundColor: '#1e293b',
                padding: '10px',
                borderRadius: '6px',
                marginBottom: '8px',
                border: '1px solid #334155',
              }}
            >
              <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                <select
                  value={newEntityType}
                  onChange={(e) => setNewEntityType(e.target.value)}
                  style={{
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    fontSize: '11px',
                    padding: '4px',
                  }}
                >
                  <option value="location_node">Mặt bằng / Vị trí</option>
                  <option value="field_issue">Vấn đề hiện trường</option>
                  <option value="task">Công việc (WBS)</option>
                  <option value="document">Tài liệu hồ sơ</option>
                </select>
                <input
                  type="text"
                  placeholder="ID thực thể..."
                  value={newEntityId}
                  onChange={(e) => setNewEntityId(e.target.value)}
                  required
                  style={{
                    flex: 1,
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    border: '1px solid #475569',
                    borderRadius: '4px',
                    fontSize: '11px',
                    padding: '4px 6px',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => setShowAddLinkForm(false)}
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid #475569',
                    color: '#94a3b8',
                    borderRadius: '4px',
                    fontSize: '11px',
                    padding: '2px 8px',
                    cursor: 'pointer',
                  }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  style={{
                    backgroundColor: '#2563eb',
                    border: 'none',
                    color: '#ffffff',
                    borderRadius: '4px',
                    fontSize: '11px',
                    padding: '2px 8px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Lưu
                </button>
              </div>
            </form>
          )}

          {links.length === 0 ? (
            <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
              Chưa có liên kết với hiện trường hoặc tiến độ WBS.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {links.map((lnk, idx) => {
                const linkKey = 'linkId' in lnk ? lnk.linkId : lnk.id || `link-${idx}`;
                return (
                  <div
                    key={linkKey}
                    style={{
                      backgroundColor: '#1e293b',
                      padding: '6px 10px',
                      borderRadius: '4px',
                      borderLeft: '3px solid #38bdf8',
                      fontSize: '11px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <span
                        style={{ fontWeight: 600, color: '#e2e8f0', textTransform: 'capitalize' }}
                      >
                        {lnk.entityType.replace('_', ' ')}
                      </span>
                      <div style={{ color: '#94a3b8', fontSize: '10px' }}>ID: {lnk.entityId}</div>
                    </div>
                    <span
                      style={{
                        backgroundColor: '#0f172a',
                        color: '#34d399',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '10px',
                      }}
                    >
                      Đã liên kết
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Property Sets Section */}
        <section aria-labelledby="bim-props-title">
          <h4
            id="bim-props-title"
            style={{
              margin: '0 0 8px 0',
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#38bdf8',
            }}
          >
            Tập thuộc tính IFC (Psets)
          </h4>

          {Object.keys(filteredGroups).length === 0 ? (
            <div style={{ fontSize: '11px', color: '#64748b', fontStyle: 'italic' }}>
              Không tìm thấy thuộc tính phù hợp với từ khóa lọc.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {Object.entries(filteredGroups).map(([psetName, props]) => (
                <div
                  key={psetName}
                  style={{
                    backgroundColor: '#1e293b',
                    borderRadius: '6px',
                    border: '1px solid #334155',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: '#334155',
                      padding: '6px 10px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#f1f5f9',
                    }}
                  >
                    {psetName}
                  </div>
                  <div
                    style={{
                      padding: '6px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    {Object.entries(props).map(([propKey, propVal]) => (
                      <div
                        key={propKey}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '11px',
                          borderBottom: '1px dotted #334155',
                          paddingBottom: '2px',
                        }}
                      >
                        <span style={{ color: '#94a3b8' }}>{propKey}</span>
                        <span
                          style={{
                            color: '#f8fafc',
                            fontWeight: 500,
                            textAlign: 'right',
                            maxWidth: '60%',
                          }}
                        >
                          {typeof propVal === 'boolean'
                            ? propVal
                              ? 'True'
                              : 'False'
                            : String(propVal)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
