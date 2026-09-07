import { useState, type FormEvent } from 'react';
import type { RfiRequest, ProjectContext, VinopsApiClient } from '../api.js';

type RfiHubProps = {
  projectId: string;
  client: VinopsApiClient;
  rfis: readonly RfiRequest[];
  projectContext?: ProjectContext | null;
  onRefresh: () => Promise<void>;
};

function getSlaBadge(dueDate?: string) {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  const diffHours = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60));

  if (diffHours < 0) {
    return (
      <span className="sla-badge sla-breached" data-testid="sla-breached">
        SLA Breached ({Math.abs(diffHours)}h overdue)
      </span>
    );
  }
  if (diffHours <= 24) {
    return (
      <span className="sla-badge sla-warning-24h" data-testid="sla-warning">
        SLA Warning: {diffHours}h remaining
      </span>
    );
  }
  if (diffHours <= 48) {
    return (
      <span className="sla-badge sla-warning-48h" data-testid="sla-warning">
        SLA Caution: {diffHours}h remaining
      </span>
    );
  }
  return (
    <span className="sla-badge sla-ok" data-testid="sla-ok">
      SLA On Track ({diffHours}h)
    </span>
  );
}

export function RfiHub({ projectId, client, rfis, onRefresh }: RfiHubProps) {
  const [selectedRfi, setSelectedRfi] = useState<RfiRequest | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);

  // New RFI form
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [priority, setPriority] = useState('Normal');
  const [dueDate, setDueDate] = useState('');

  // Official Response form
  const [responseText, setResponseText] = useState('');
  const [costImpact, setCostImpact] = useState(false);
  const [scheduleImpact, setScheduleImpact] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await client.createRfi(projectId, {
        title,
        question,
        priority,
        ...(dueDate ? { due_date: new Date(dueDate).toISOString() } : {}),
      });
      setShowCreateModal(false);
      setTitle('');
      setQuestion('');
      setDueDate('');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create RFI');
    } finally {
      setLoading(false);
    }
  };

  const handleTransition = async (rfi: RfiRequest, action: string) => {
    setLoading(true);
    try {
      await client.transitionRfi(projectId, rfi.id, action);
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResponse = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedRfi) return;
    setLoading(true);
    setError(null);
    try {
      await client.addRfiResponse(projectId, selectedRfi.id, {
        response_text: responseText,
        is_official: true,
        cost_impact: costImpact,
        schedule_impact: scheduleImpact,
      });
      setShowResponseModal(false);
      setSelectedRfi(null);
      setResponseText('');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Official response failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rfi-hub-container" data-testid="rfi-hub">
      <header className="hub-header">
        <div className="header-actions">
          <h2>Technical Inquiries (RFI Hub)</h2>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
            data-testid="create-rfi-btn"
          >
            + Create New RFI
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </header>

      <div className="rfi-table-wrapper">
        <table className="data-table" data-testid="rfi-table">
          <thead>
            <tr>
              <th>RFI #</th>
              <th>Title</th>
              <th>Priority</th>
              <th>Status</th>
              <th>Ball-in-Court</th>
              <th>SLA Due</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rfis.map((rfi) => (
              <tr key={rfi.id} data-testid={`rfi-row-${rfi.rfiNumber}`}>
                <td className="rfi-code">{rfi.rfiNumber}</td>
                <td>
                  <strong>{rfi.title}</strong>
                  {rfi.sourceIssueId && (
                    <span className="source-issue-tag">Escalated from Issue</span>
                  )}
                </td>
                <td>
                  <span className={`priority-tag priority-${rfi.priority.toLowerCase()}`}>
                    {rfi.priority}
                  </span>
                </td>
                <td>
                  <span className="status-badge">{rfi.status}</span>
                </td>
                <td>
                  <span className="bic-badge" data-testid="bic-badge">
                    {rfi.ballInCourtOrganizationId ? 'Assigned Party' : 'Pending Assignment'}
                  </span>
                </td>
                <td>{getSlaBadge(rfi.dueDate)}</td>
                <td className="action-cell">
                  {rfi.status === 'Draft' && (
                    <button
                      className="btn-sm"
                      onClick={() => void handleTransition(rfi, 'submit')}
                      data-testid={`btn-submit-${rfi.rfiNumber}`}
                    >
                      Submit
                    </button>
                  )}
                  {rfi.status === 'Submitted' && (
                    <button
                      className="btn-sm"
                      onClick={() => void handleTransition(rfi, 'start_review')}
                      data-testid={`btn-review-${rfi.rfiNumber}`}
                    >
                      Start Review
                    </button>
                  )}
                  {rfi.status === 'Under Review' && (
                    <button
                      className="btn-sm btn-primary"
                      onClick={() => {
                        setSelectedRfi(rfi);
                        setShowResponseModal(true);
                      }}
                      data-testid={`btn-answer-${rfi.rfiNumber}`}
                    >
                      Official Answer
                    </button>
                  )}
                  {rfi.status === 'Official Answered' && (
                    <button
                      className="btn-sm"
                      onClick={() => void handleTransition(rfi, 'close')}
                      data-testid={`btn-close-${rfi.rfiNumber}`}
                    >
                      Close RFI
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rfis.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-cell">
                  No RFIs found for this project.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <div className="modal-overlay" data-testid="create-rfi-modal">
          <div className="modal-card">
            <h3>Submit Request for Information (RFI)</h3>
            <form onSubmit={(e) => void handleCreate(e)}>
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Clarification on Column C3 rebar cover"
                  data-testid="rfi-title-input"
                />
              </div>
              <div className="form-group">
                <label>Question / Detailed Request *</label>
                <textarea
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={4}
                  placeholder="State the technical discrepancy and requested guidance..."
                  data-testid="rfi-question-input"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Priority</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    data-testid="rfi-priority-input"
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Required Due Date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    data-testid="rfi-duedate-input"
                  />
                </div>
              </div>
              <div className="modal-buttons">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                  data-testid="submit-rfi-btn"
                >
                  {loading ? 'Creating...' : 'Create RFI'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResponseModal && selectedRfi && (
        <div className="modal-overlay" data-testid="rfi-response-modal">
          <div className="modal-card">
            <h3>Provide Official Response</h3>
            <p>
              Answering <strong>{selectedRfi.rfiNumber}</strong>: {selectedRfi.title}
            </p>
            <form onSubmit={(e) => void handleResponse(e)}>
              <div className="form-group">
                <label>Official Technical Answer *</label>
                <textarea
                  required
                  value={responseText}
                  onChange={(e) => setResponseText(e.target.value)}
                  rows={5}
                  placeholder="Enter comprehensive engineering response..."
                  data-testid="response-text-input"
                />
              </div>
              <div className="form-checkboxes">
                <label>
                  <input
                    type="checkbox"
                    checked={costImpact}
                    onChange={(e) => setCostImpact(e.target.checked)}
                    data-testid="cost-impact-checkbox"
                  />
                  Has Cost Impact
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={scheduleImpact}
                    onChange={(e) => setScheduleImpact(e.target.checked)}
                    data-testid="schedule-impact-checkbox"
                  />
                  Has Schedule Impact
                </label>
              </div>
              <div className="modal-buttons">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowResponseModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                  data-testid="submit-response-btn"
                >
                  {loading ? 'Submitting...' : 'Submit Official Answer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
