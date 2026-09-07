import React, { useState } from 'react';

export type SignatureVerificationData = {
  status: 'valid' | 'invalid' | 'expired' | 'indeterminate';
  signerName: string;
  signerRole?: string;
  organization?: string;
  caIssuer: string;
  certificateSerial: string;
  signingTime: string;
  tsaTimestamp?: string;
  padesLevel?: string;
  isIntegrityIntact?: boolean;
  certValidTo?: string;
};

export type SignatureValidatorBadgeProps = {
  verification: SignatureVerificationData;
  showDetailsOnClick?: boolean;
};

export function SignatureValidatorBadge({
  verification,
  showDetailsOnClick = true,
}: SignatureValidatorBadgeProps): React.JSX.Element {
  const [showTooltip, setShowTooltip] = useState<boolean>(false);

  let badgeColor = '#16a34a'; // green
  let badgeBg = '#dcfce7';
  let badgeBorder = '#bbf7d0';
  let badgeIcon = '🟢';
  let statusText = 'Chữ ký số Hợp lệ';

  if (verification.status === 'invalid' || verification.isIntegrityIntact === false) {
    badgeColor = '#dc2626'; // red
    badgeBg = '#fee2e2';
    badgeBorder = '#fecaca';
    badgeIcon = '🔴';
    statusText = 'Văn bản bị sửa đổi sau khi ký';
  } else if (verification.status === 'expired') {
    badgeColor = '#d97706'; // yellow
    badgeBg = '#fef3c7';
    badgeBorder = '#fde68a';
    badgeIcon = '🟡';
    statusText = 'Chứng thư số Hết hạn';
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => showDetailsOnClick && setShowTooltip((prev) => !prev)}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '9999px',
          border: `1px solid ${badgeBorder}`,
          backgroundColor: badgeBg,
          color: badgeColor,
          fontSize: '0.8rem',
          fontWeight: 600,
          cursor: showDetailsOnClick ? 'pointer' : 'default',
          transition: 'all 0.15s ease',
          outline: 'none',
        }}
        aria-label={`Trạng thái chữ ký: ${statusText}`}
      >
        <span>{badgeIcon}</span>
        <span>{statusText}</span>
      </button>

      {showTooltip && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 8px)',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '320px',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            borderRadius: '8px',
            padding: '12px 14px',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1)',
            zIndex: 10000,
            fontSize: '0.8rem',
            lineHeight: 1.5,
            pointerEvents: 'none',
          }}
          role="tooltip"
        >
          <div
            style={{
              fontWeight: 700,
              marginBottom: '6px',
              borderBottom: '1px solid #334155',
              paddingBottom: '4px',
            }}
          >
            Thông tin Thẩm tra Chữ ký số PKI
          </div>
          <div>
            <strong>Người ký:</strong> {verification.signerName}
          </div>
          {verification.organization && (
            <div>
              <strong>Đơn vị:</strong> {verification.organization}
            </div>
          )}
          <div>
            <strong>Cơ quan cấp CA:</strong> {verification.caIssuer}
          </div>
          <div>
            <strong>Số Serial:</strong> {verification.certificateSerial}
          </div>
          <div>
            <strong>Thời điểm ký:</strong> {verification.signingTime}
          </div>
          {verification.tsaTimestamp && (
            <div>
              <strong>Dấu thời gian TSA:</strong> {verification.tsaTimestamp}
            </div>
          )}
          {verification.certValidTo && (
            <div>
              <strong>Hạn chứng thư:</strong> {verification.certValidTo}
            </div>
          )}
          {verification.padesLevel && (
            <div>
              <strong>Cấp độ PAdES:</strong> {verification.padesLevel}
            </div>
          )}
          <div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#94a3b8' }}>
            Căn cứ pháp lý: Luật GDĐT 20/2023/QH15 & NĐ 207/2026/NĐ-CP
          </div>
        </div>
      )}
    </div>
  );
}
