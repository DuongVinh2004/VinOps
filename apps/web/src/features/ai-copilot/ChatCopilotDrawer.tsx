import React, { useState, useRef, useEffect } from 'react';

export type ChatMessage = {
  id: string;
  sender: 'user' | 'assistant';
  content: string;
  citedSources?:
    | Array<{
        documentCode: string;
        documentTitle: string;
        clause: string;
        similarityScore: number;
      }>
    | undefined;
  timestamp: string;
};

export type ChatCopilotDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onSendMessage?: (question: string) => Promise<{
    answer: string;
    citedSources?: Array<{
      documentCode: string;
      documentTitle: string;
      clause: string;
      similarityScore: number;
    }>;
  }>;
};

export function ChatCopilotDrawer({
  isOpen,
  onClose,
  projectId,
  onSendMessage,
}: ChatCopilotDrawerProps): React.JSX.Element | null {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      content:
        'Xin chào Kỹ sư! Tôi là Trợ lý RFI & Tiêu chuẩn Kỹ thuật VinOps. Bạn cần tra cứu điều khoản TCVN, chỉ dẫn kỹ thuật Specs hoặc soạn thảo phản hồi RFI nào?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  if (!isOpen) return null;

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isTyping) return;

    const userText = input.trim();
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      content: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsTyping(true);

    try {
      if (onSendMessage) {
        const response = await onSendMessage(userText);
        setMessages((prev) => [
          ...prev,
          {
            id: `asst-${Date.now()}`,
            sender: 'assistant',
            content: response.answer,
            citedSources: response.citedSources,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        ]);
      } else {
        // Local simulation if no remote handler attached
        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              id: `asst-${Date.now()}`,
              sender: 'assistant',
              content: `Căn cứ theo Chỉ dẫn kỹ thuật dự án Mục 03200 (Cốt thép kết cấu) và Tiêu chuẩn TCVN 5574:2018:\n\n1. Tại vị trí dầm giao dầm, Nhà thầu phải bố trí cốt đai gia cường bước dày @50mm.\n2. Bổ sung chi tiết Shop Drawing cập nhật trước khi nghiệm thu.`,
              citedSources: [
                {
                  documentCode: 'SPEC-STR-03200',
                  documentTitle: 'Chỉ dẫn kỹ thuật Thi công Bê tông & Cốt thép',
                  clause: 'Mục 3.4.B, Trang 48',
                  similarityScore: 0.892,
                },
                {
                  documentCode: 'TCVN-5574-2018',
                  documentTitle: 'Tiêu chuẩn Thiết kế Kết cấu Bê tông và Bê tông Cốt thép',
                  clause: 'Điều 8.3.2',
                  similarityScore: 0.854,
                },
              ],
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
          setIsTyping(false);
        }, 800);
        return;
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          content: 'Không thể kết nối với dịch vụ AI Copilot. Vui lòng thử lại sau.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const copyToClipboard = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '100%',
        maxWidth: '480px',
        height: '100%',
        backgroundColor: '#FFFFFF',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.15)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid #E5E7EB',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#1E293B',
          color: '#FFFFFF',
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
            VinOps RFI & Tech Copilot
          </h3>
          <p style={{ margin: 0, fontSize: '12px', color: '#94A3B8' }}>Dự án: {projectId}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#FFFFFF',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          ×
        </button>
      </div>

      {/* Messages Feed */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          backgroundColor: '#F8FAFC',
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              backgroundColor: msg.sender === 'user' ? '#2563EB' : '#FFFFFF',
              color: msg.sender === 'user' ? '#FFFFFF' : '#1E293B',
              borderRadius: '12px',
              padding: '12px 14px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              border: msg.sender === 'assistant' ? '1px solid #E2E8F0' : 'none',
            }}
          >
            <div style={{ whiteSpace: 'pre-wrap', fontSize: '13px', lineHeight: '1.5' }}>
              {msg.content}
            </div>

            {/* Cited Standards Block */}
            {msg.citedSources && msg.citedSources.length > 0 && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '8px 10px',
                  backgroundColor: '#F1F5F9',
                  borderRadius: '6px',
                  fontSize: '11px',
                  color: '#475569',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                  Căn cứ quy chuẩn trích dẫn:
                </div>
                {msg.citedSources.map((s, idx) => (
                  <div key={idx} style={{ marginTop: '2px' }}>
                    • <strong>{s.documentCode}</strong> ({s.clause}): {s.documentTitle}
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '6px',
                fontSize: '10px',
                color: msg.sender === 'user' ? '#BFDBFE' : '#94A3B8',
              }}
            >
              <span>{msg.timestamp}</span>
              {msg.sender === 'assistant' && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(msg.id, msg.content)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: copiedId === msg.id ? '#10B981' : '#64748B',
                    cursor: 'pointer',
                    fontSize: '11px',
                    padding: '0 4px',
                  }}
                >
                  {copiedId === msg.id ? 'Đã sao chép' : 'Sao chép'}
                </button>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div
            style={{
              alignSelf: 'flex-start',
              backgroundColor: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '10px 14px',
              color: '#64748B',
              fontSize: '12px',
            }}
          >
            Đang tra cứu tiêu chuẩn & soạn thảo...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Box */}
      <form
        onSubmit={(e) => {
          void handleSend(e);
        }}
        style={{
          padding: '12px',
          borderTop: '1px solid #E5E7EB',
          display: 'flex',
          gap: '8px',
          backgroundColor: '#FFFFFF',
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Hỏi về TCVN, chỉ dẫn kỹ thuật hoặc yêu cầu RFI..."
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: '6px',
            border: '1px solid #CBD5E1',
            fontSize: '13px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!input.trim() || isTyping}
          style={{
            backgroundColor: '#2563EB',
            color: '#FFFFFF',
            border: 'none',
            borderRadius: '6px',
            padding: '0 16px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: input.trim() && !isTyping ? 'pointer' : 'not-allowed',
            opacity: input.trim() && !isTyping ? 1 : 0.6,
          }}
        >
          Gửi
        </button>
      </form>
    </div>
  );
}
