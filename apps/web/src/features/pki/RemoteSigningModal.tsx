import React, { useState, useEffect } from 'react';

export type SigningProviderChoice = 'vnpt_smartca' | 'viettel_cloud_ca' | 'trust_ca';

export type RemoteSigningModalProps = {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
  documentType: string;
  documentDate?: string;
  projectId: string;
  sessionId: string;
  signerRole: 'contractor_rep' | 'tvgs_lead' | 'pmu_manager';
  onSignSuccess?: (data: unknown) => void;
  onRejectSuccess?: (data: unknown) => void;
  onAuthorize?: (
    sessionId: string,
    provider: SigningProviderChoice,
  ) => Promise<{ cscTransactionId: string; challengeType: string }>;
  onCompleteSign?: (sessionId: string, otpCode: string, note?: string) => Promise<unknown>;
  onReject?: (sessionId: string, reason: string) => Promise<unknown>;
};

const PROVIDER_LABELS: Record<SigningProviderChoice, { name: string; desc: string }> = {
  vnpt_smartca: {
    name: 'VNPT SmartCA',
    desc: 'Tập đoàn Bưu chính Viễn thông Việt Nam (Ký qua ứng dụng di động / Push)',
  },
  viettel_cloud_ca: {
    name: 'Viettel Cloud CA',
    desc: 'Tập đoàn Công nghiệp - Viễn thông Quân đội (Ký qua MySign Viettel)',
  },
  trust_ca: {
    name: 'TrustCA (SAVIS)',
    desc: 'Dịch vụ chứng thực chữ ký số công cộng SAVIS PKI Cloud HSM',
  },
};

const ROLE_LABELS = {
  contractor_rep: 'Đại diện Nhà thầu thi công (Bước 1/3)',
  tvgs_lead: 'Tư vấn Giám sát trưởng (Bước 2/3)',
  pmu_manager: 'Đại diện Ban Quản lý Dự án (Bước 3/3)',
};

export function RemoteSigningModal({
  isOpen,
  onClose,
  documentTitle,
  documentType,
  documentDate,
  sessionId,
  signerRole,
  onSignSuccess,
  onRejectSuccess,
  onAuthorize,
  onCompleteSign,
  onReject,
}: RemoteSigningModalProps): React.JSX.Element | null {
  const [selectedProvider, setSelectedProvider] = useState<SigningProviderChoice>('vnpt_smartca');
  const [step, setStep] = useState<'select' | 'waiting_otp' | 'success' | 'reject_form'>('select');
  const [countdown, setCountdown] = useState<number>(120);
  const [otpCode, setOtpCode] = useState<string>('');
  const [signerNote, setSignerNote] = useState<string>('');
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [, setSuccessPayload] = useState<unknown>(null);

  // Timer countdown for OTP
  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (step === 'waiting_otp' && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => prev - 1);
      }, 1000);
    } else if (countdown === 0 && step === 'waiting_otp') {
      setErrorMessage('Phiên xác thực OTP đã hết hạn (120s). Vui lòng thực hiện lại.');
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [step, countdown]);

  if (!isOpen) return null;

  const handleStartAuthorize = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (onAuthorize) {
        await onAuthorize(sessionId, selectedProvider);
      }
      setCountdown(120);
      setStep('waiting_otp');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Không thể khởi tạo phiên ủy quyền ký số.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmSign = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = onCompleteSign
        ? await onCompleteSign(sessionId, otpCode, signerNote)
        : { status: 'signed' };
      setSuccessPayload(result);
      setStep('success');
      if (onSignSuccess) onSignSuccess(result);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Ký số thất bại hoặc mã PIN/OTP không hợp lệ.',
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectionReason.trim()) {
      setErrorMessage('Vui lòng nhập lý do từ chối ký theo quy định pháp lý.');
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const result = onReject ? await onReject(sessionId, rejectionReason) : { status: 'rejected' };
      if (onRejectSuccess) onRejectSuccess(result);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Không thể gửi lý do từ chối.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
        backdropFilter: 'blur(4px)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pki-modal-title"
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '540px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 24px',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 id="pki-modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
              Ký số Pháp lý PKI / Remote Signing
            </h2>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '4px' }}>
              Tuân thủ Luật Giao dịch điện tử 2023 & NĐ 207/2026/NĐ-CP
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              fontSize: '1.25rem',
            }}
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          {errorMessage && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '0.9rem',
              }}
            >
              ⚠️ {errorMessage}
            </div>
          )}

          {step === 'select' && (
            <div>
              {/* Document Overview Card */}
              <div
                style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '14px 16px',
                  marginBottom: '20px',
                }}
              >
                <div
                  style={{
                    fontSize: '0.8rem',
                    textTransform: 'uppercase',
                    color: '#64748b',
                    fontWeight: 600,
                  }}
                >
                  Thông tin văn bản nghiệm thu
                </div>
                <div
                  style={{
                    fontSize: '1.05rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    marginTop: '4px',
                  }}
                >
                  {documentTitle}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: '6px' }}>
                  Loại văn bản: <strong>{documentType}</strong> | Vai trò ký:{' '}
                  <span style={{ color: '#0369a1', fontWeight: 600 }}>
                    {ROLE_LABELS[signerRole]}
                  </span>
                </div>
                {documentDate && (
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                    Ngày lập: {documentDate}
                  </div>
                )}
              </div>

              {/* CA Selection */}
              <label
                style={{
                  display: 'block',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  color: '#334155',
                  marginBottom: '8px',
                }}
              >
                Chọn Nhà cung cấp Dịch vụ Chứng thực Chữ ký số (CA):
              </label>
              {(Object.keys(PROVIDER_LABELS) as SigningProviderChoice[]).map((code) => {
                const info = PROVIDER_LABELS[code];
                const isSelected = selectedProvider === code;
                return (
                  <div
                    key={code}
                    onClick={() => setSelectedProvider(code)}
                    style={{
                      border: isSelected ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                      borderRadius: '8px',
                      padding: '12px 16px',
                      marginBottom: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease-in-out',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: isSelected ? '#1d4ed8' : '#1e293b' }}>
                        {info.name}
                      </span>
                      <input
                        type="radio"
                        name="signing-provider"
                        checked={isSelected}
                        onChange={() => setSelectedProvider(code)}
                        style={{ accentColor: '#2563eb' }}
                      />
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                      {info.desc}
                    </div>
                  </div>
                );
              })}

              <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                <button
                  type="button"
                  onClick={() => setStep('reject_form')}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #ef4444',
                    color: '#dc2626',
                    backgroundColor: '#ffffff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Từ chối ký
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    void handleStartAuthorize();
                  }}
                  style={{
                    flex: 2,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    opacity: isLoading ? 0.7 : 1,
                  }}
                >
                  {isLoading ? 'Đang gửi yêu cầu...' : 'Ký số điện tử'}
                </button>
              </div>
            </div>
          )}

          {step === 'waiting_otp' && (
            <div style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: '#dbeafe',
                  color: '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.75rem',
                  margin: '0 auto 16px auto',
                }}
              >
                📲
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.2rem', color: '#0f172a' }}>
                Đang chờ duyệt trên {PROVIDER_LABELS[selectedProvider].name}
              </h3>
              <p
                style={{
                  color: '#475569',
                  fontSize: '0.9rem',
                  margin: '0 0 20px 0',
                  lineHeight: 1.5,
                }}
              >
                Vui lòng mở ứng dụng <strong>{PROVIDER_LABELS[selectedProvider].name}</strong> trên
                điện thoại thông minh của bạn để xác thực thông báo đẩy hoặc nhập mã OTP/PIN ký số
                bên dưới.
              </p>

              {/* Countdown badge */}
              <div
                style={{
                  display: 'inline-block',
                  backgroundColor: countdown < 30 ? '#fee2e2' : '#f1f5f9',
                  color: countdown < 30 ? '#dc2626' : '#334155',
                  padding: '6px 16px',
                  borderRadius: '20px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  marginBottom: '20px',
                }}
              >
                ⏱️ Thời gian còn lại: {Math.floor(countdown / 60)}:
                {String(countdown % 60).padStart(2, '0')}
              </div>

              <div style={{ textAlign: 'left', marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: '6px',
                  }}
                >
                  Mã OTP / PIN ký số SmartCA:
                </label>
                <input
                  type="text"
                  placeholder="Nhập 6 chữ số OTP hoặc mã PIN..."
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  maxLength={12}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '1rem',
                    textAlign: 'center',
                    letterSpacing: '3px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ textAlign: 'left', marginBottom: '24px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    color: '#334155',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú nội dung nghiệm thu (Tùy chọn):
                </label>
                <input
                  type="text"
                  placeholder="Ví dụ: Đã nghiệm thu hiện trường đạt TCVN..."
                  value={signerNote}
                  onChange={(e) => setSignerNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Quay lại
                </button>
                <button
                  type="button"
                  disabled={isLoading || countdown === 0}
                  onClick={() => {
                    void handleConfirmSign();
                  }}
                  style={{
                    flex: 2,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: isLoading || countdown === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isLoading ? 'Đang xác thực...' : 'Xác nhận Ký số'}
                </button>
              </div>
            </div>
          )}

          {step === 'reject_form' && (
            <div>
              <div
                style={{
                  backgroundColor: '#fff1f2',
                  border: '1px solid #ffe4e6',
                  color: '#9f1239',
                  padding: '12px',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  fontSize: '0.85rem',
                }}
              >
                ⚠️ <strong>Cảnh báo Pháp lý:</strong> Thao tác từ chối ký sẽ dừng toàn bộ quy trình
                nghiệm thu đa bên. Lý do từ chối sẽ được lưu vĩnh viễn vào nhật ký kiểm toán phục vụ
                thanh tra chất lượng.
              </div>

              <label
                style={{
                  display: 'block',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  color: '#334155',
                  marginBottom: '6px',
                }}
              >
                Lý do từ chối ký (Bắt buộc theo TT 32/2026/TT-BXD):
              </label>
              <textarea
                rows={4}
                placeholder="Nêu rõ sai lệch hiện trường, vị trí, sai lệch kích thước hình học hoặc thiếu phiếu thí nghiệm..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.9rem',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />

              <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  style={{
                    flex: 1,
                    padding: '12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    backgroundColor: '#ffffff',
                    color: '#475569',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Hủy bỏ
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => {
                    void handleConfirmReject();
                  }}
                  style={{
                    flex: 2,
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isLoading ? 'Đang gửi...' : 'Xác nhận Từ chối Ký'}
                </button>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '50%',
                  backgroundColor: '#dcfce7',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '2rem',
                  margin: '0 auto 16px auto',
                }}
              >
                ✓
              </div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '1.25rem', color: '#14532d' }}>
                Ký số PAdES Thành công!
              </h3>
              <p style={{ color: '#475569', fontSize: '0.9rem', margin: '0 0 20px 0' }}>
                Chữ ký số đã được tích hợp vào tài liệu cùng dấu thời gian tin cậy TSA RFC 3161 và
                chứng thư số hợp lệ.
              </p>
              <button
                type="button"
                onClick={onClose}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Hoàn tất & Đóng
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
