import { useState, type FormEvent } from 'react';
import type { FieldIssue, ProjectContext, VinopsApiClient } from '../api.js';

type IssueKanbanProps = {
  projectId: string;
  client: VinopsApiClient;
  issues: readonly FieldIssue[];
  projectContext?: ProjectContext | null;
  onRefresh: () => Promise<void>;
};

const KANBAN_COLUMNS: Array<{ status: FieldIssue['status']; title: string }> = [
  { status: 'Open', title: 'Open' },
  { status: 'Under Triage', title: 'Under Triage' },
  { status: 'Assigned', title: 'Assigned' },
  { status: 'In Progress', title: 'In Progress' },
  { status: 'Resolved', title: 'Resolved' },
  { status: 'Closed', title: 'Closed' },
];

export function IssueKanban({ projectId, client, issues, onRefresh }: IssueKanbanProps) {
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [selectedIssue, setSelectedIssue] = useState<FieldIssue | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEscalateModal, setShowEscalateModal] = useState(false);

  // Form states
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newSeverity, setNewSeverity] = useState('Medium');
  const [newLat, setNewLat] = useState<string>('');
  const [newLng, setNewLng] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escalate form
  const [escalateQuestion, setEscalateQuestion] = useState('');
  const [escalatePriority, setEscalatePriority] = useState('High');

  const filteredIssues = issues.filter((iss) => {
    if (severityFilter !== 'all' && iss.severity !== severityFilter) {
      return false;
    }
    return true;
  });

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const lat = newLat ? parseFloat(newLat) : undefined;
      const lng = newLng ? parseFloat(newLng) : undefined;
      await client.quickCreateIssue(projectId, {
        title: newTitle,
        description: newDesc,
        severity: newSeverity,
        ...(lat !== undefined && lng !== undefined ? { gps_lat: lat, gps_lng: lng } : {}),
      });
      setShowCreateModal(false);
      setNewTitle('');
      setNewDesc('');
      setNewLat('');
      setNewLng('');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create issue');
    } finally {
      setLoading(false);
    }
  };

  const handleTransition = async (issue: FieldIssue, nextStatus: FieldIssue['status']) => {
    setLoading(true);
    try {
      await client.transitionIssue(projectId, issue.id, nextStatus);
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setLoading(false);
    }
  };

  const handleEscalate = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedIssue) return;
    setLoading(true);
    setError(null);
    try {
      await client.escalateIssueToRfi(projectId, selectedIssue.id, {
        title: `[Escalated] ${selectedIssue.title}`,
        question: escalateQuestion || selectedIssue.description,
        priority: escalatePriority,
      });
      setShowEscalateModal(false);
      setSelectedIssue(null);
      setEscalateQuestion('');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Escalation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="issues-kanban-container" data-testid="issues-kanban">
      <header className="kanban-header">
        <div className="header-actions">
          <h2>Field Issues Board</h2>
          <div className="filters">
            <label htmlFor="severity-select">Severity: </label>
            <select
              id="severity-select"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              data-testid="severity-filter"
            >
              <option value="all">All Severities</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Critical">Critical</option>
            </select>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
            data-testid="quick-create-btn"
          >
            + Quick Create Issue
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </header>

      <div className="kanban-columns">
        {KANBAN_COLUMNS.map((col) => {
          const colIssues = filteredIssues.filter((i) => i.status === col.status);
          return (
            <div key={col.status} className="kanban-column" data-testid={`col-${col.status}`}>
              <div className="col-header">
                <h3>{col.title}</h3>
                <span className="badge count-badge">{colIssues.length}</span>
              </div>
              <div className="card-list">
                {colIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="issue-card"
                    data-testid={`issue-${issue.issueNumber}`}
                  >
                    <div className="card-top">
                      <span className="issue-code">{issue.issueNumber}</span>
                      <span className={`severity-tag severity-${issue.severity.toLowerCase()}`}>
                        {issue.severity}
                      </span>
                    </div>
                    <h4 className="issue-title">{issue.title}</h4>
                    <p className="issue-desc">{issue.description}</p>
                    {issue.gpsLat !== undefined && issue.gpsLng !== undefined && (
                      <div className="gps-badge" data-testid="gps-badge">
                        GPS: {issue.gpsLat.toFixed(4)}, {issue.gpsLng.toFixed(4)}
                      </div>
                    )}
                    {issue.rfiId && (
                      <div className="rfi-linked-badge" data-testid="rfi-linked-badge">
                        Linked RFI
                      </div>
                    )}
                    <div className="card-actions">
                      {col.status === 'Open' && (
                        <button
                          className="btn-sm"
                          onClick={() => void handleTransition(issue, 'Under Triage')}
                        >
                          Triage
                        </button>
                      )}
                      {col.status === 'Under Triage' && (
                        <button
                          className="btn-sm"
                          onClick={() => void handleTransition(issue, 'Assigned')}
                        >
                          Assign
                        </button>
                      )}
                      {col.status === 'Assigned' && (
                        <button
                          className="btn-sm"
                          onClick={() => void handleTransition(issue, 'In Progress')}
                        >
                          Start Work
                        </button>
                      )}
                      {col.status === 'In Progress' && (
                        <button
                          className="btn-sm"
                          onClick={() => void handleTransition(issue, 'Resolved')}
                        >
                          Resolve
                        </button>
                      )}
                      {col.status === 'Resolved' && (
                        <button
                          className="btn-sm"
                          onClick={() => void handleTransition(issue, 'Closed')}
                        >
                          Close
                        </button>
                      )}
                      {!issue.rfiId && (
                        <button
                          className="btn-sm btn-escalate"
                          onClick={() => {
                            setSelectedIssue(issue);
                            setEscalateQuestion(issue.description);
                            setShowEscalateModal(true);
                          }}
                          data-testid={`escalate-btn-${issue.issueNumber}`}
                        >
                          Escalate to RFI
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" data-testid="quick-create-modal">
          <div className="modal-card">
            <h3>Quick Create Issue (GPS Enabled)</h3>
            <form onSubmit={(e) => void handleCreate(e)}>
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Honeycomb concrete at Column C3"
                  data-testid="input-title"
                />
              </div>
              <div className="form-group">
                <label>Description *</label>
                <textarea
                  required
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Describe location and severity..."
                  data-testid="input-description"
                />
              </div>
              <div className="form-group">
                <label>Severity</label>
                <select
                  value={newSeverity}
                  onChange={(e) => setNewSeverity(e.target.value)}
                  data-testid="input-severity"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>GPS Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={newLat}
                    onChange={(e) => setNewLat(e.target.value)}
                    placeholder="21.0285"
                    data-testid="input-lat"
                  />
                </div>
                <div className="form-group">
                  <label>GPS Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={newLng}
                    onChange={(e) => setNewLng(e.target.value)}
                    placeholder="105.8542"
                    data-testid="input-lng"
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
                  data-testid="submit-issue-btn"
                >
                  {loading ? 'Creating...' : 'Create Issue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEscalateModal && selectedIssue && (
        <div className="modal-overlay" data-testid="escalate-modal">
          <div className="modal-card">
            <h3>Escalate Issue to Official RFI</h3>
            <p>
              Escalating <strong>{selectedIssue.issueNumber}</strong>: {selectedIssue.title}
            </p>
            <form onSubmit={(e) => void handleEscalate(e)}>
              <div className="form-group">
                <label>RFI Technical Question *</label>
                <textarea
                  required
                  value={escalateQuestion}
                  onChange={(e) => setEscalateQuestion(e.target.value)}
                  rows={4}
                  data-testid="escalate-question"
                />
              </div>
              <div className="form-group">
                <label>Priority</label>
                <select
                  value={escalatePriority}
                  onChange={(e) => setEscalatePriority(e.target.value)}
                  data-testid="escalate-priority"
                >
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
              <div className="modal-buttons">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowEscalateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                  data-testid="confirm-escalate-btn"
                >
                  {loading ? 'Escalating...' : 'Confirm Escalation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
