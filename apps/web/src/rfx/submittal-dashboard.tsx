import { useState, type FormEvent } from 'react';
import type { Submittal, ProjectContext, VinopsApiClient } from '../api.js';

type SubmittalDashboardProps = {
  projectId: string;
  client: VinopsApiClient;
  submittals: readonly Submittal[];
  projectContext?: ProjectContext | null;
  onRefresh: () => Promise<void>;
};

function getReviewBadge(code?: string, status?: string) {
  if (code === 'A' || status === 'Approved') {
    return (
      <span className="decision-badge code-a" data-testid="decision-code-a">
        Code A: Approved
      </span>
    );
  }
  if (code === 'B' || status === 'Approved as Noted') {
    return (
      <span className="decision-badge code-b" data-testid="decision-code-b">
        Code B: Approved as Noted
      </span>
    );
  }
  if (code === 'C' || status === 'Revise and Resubmit') {
    return (
      <span className="decision-badge code-c" data-testid="decision-code-c">
        Code C: Revise & Resubmit
      </span>
    );
  }
  if (code === 'D' || status === 'Rejected') {
    return (
      <span className="decision-badge code-d" data-testid="decision-code-d">
        Code D: Rejected
      </span>
    );
  }
  return <span className="status-badge">{status}</span>;
}

export function SubmittalDashboard({
  projectId,
  client,
  submittals,
  onRefresh,
}: SubmittalDashboardProps) {
  const [selectedSubmittal, setSelectedSubmittal] = useState<Submittal | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);

  // New submittal form
  const [title, setTitle] = useState('');
  const [submittalType, setSubmittalType] = useState('Material Sample');
  const [description, setDescription] = useState('');
  const [makerOrgId] = useState('');
  const [itemTradeName, setItemTradeName] = useState('');
  const [itemManufacturer, setItemManufacturer] = useState('');

  // Review form
  const [decisionCode, setDecisionCode] = useState<'A' | 'B' | 'C' | 'D'>('A');
  const [reviewComments, setReviewComments] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await client.createSubmittal(projectId, {
        title,
        submittal_type: submittalType,
        maker_partner_organization_id: makerOrgId || '00000000-0000-0000-0000-000000000001',
        description,
        items: [
          {
            item_number: 1,
            description: title,
            material_trade_name: itemTradeName,
            manufacturer_name: itemManufacturer,
          },
        ],
      });
      setShowCreateModal(false);
      setTitle('');
      setDescription('');
      setItemTradeName('');
      setItemManufacturer('');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create submittal');
    } finally {
      setLoading(false);
    }
  };

  const handleTransition = async (sub: Submittal, nextStatus: string) => {
    setLoading(true);
    try {
      await client.transitionSubmittal(projectId, sub.id, nextStatus);
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transition failed');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedSubmittal) return;
    setLoading(true);
    setError(null);
    try {
      await client.reviewSubmittal(projectId, selectedSubmittal.id, {
        decision_code: decisionCode,
        review_comments: reviewComments,
      });
      setShowReviewModal(false);
      setSelectedSubmittal(null);
      setReviewComments('');
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Review submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="submittals-dashboard-container" data-testid="submittal-dashboard">
      <header className="dashboard-header">
        <div className="header-actions">
          <h2>Material & Technical Submittals (Maker-Checker)</h2>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
            data-testid="create-submittal-btn"
          >
            + New Submittal Package
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
      </header>

      <div className="submittal-table-wrapper">
        <table className="data-table" data-testid="submittal-table">
          <thead>
            <tr>
              <th>Submittal #</th>
              <th>Title</th>
              <th>Type</th>
              <th>Maker-Checker Status</th>
              <th>Decision</th>
              <th>Ball-in-Court</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {submittals.map((sub) => (
              <tr key={sub.id} data-testid={`submittal-row-${sub.submittalNumber}`}>
                <td className="sub-code">{sub.submittalNumber}</td>
                <td>
                  <strong>{sub.title}</strong>
                  {sub.description && <p className="sub-desc">{sub.description}</p>}
                </td>
                <td>{sub.submittalType}</td>
                <td>
                  <span className="status-badge">{sub.status}</span>
                </td>
                <td>{getReviewBadge(sub.reviewDecisionCode, sub.status)}</td>
                <td>
                  <span className="bic-badge">
                    {sub.ballInCourtOrganizationId ? 'In Review' : 'Maker Prepared'}
                  </span>
                </td>
                <td className="action-cell">
                  {sub.status === 'Draft' && (
                    <button
                      className="btn-sm"
                      onClick={() => void handleTransition(sub, 'Submitted')}
                      data-testid={`btn-submit-${sub.submittalNumber}`}
                    >
                      Submit for Review
                    </button>
                  )}
                  {sub.status === 'Submitted' && (
                    <button
                      className="btn-sm"
                      onClick={() => void handleTransition(sub, 'Under Review')}
                      data-testid={`btn-under-review-${sub.submittalNumber}`}
                    >
                      Acknowledge Review
                    </button>
                  )}
                  {sub.status === 'Under Review' && (
                    <button
                      className="btn-sm btn-primary"
                      onClick={() => {
                        setSelectedSubmittal(sub);
                        setShowReviewModal(true);
                      }}
                      data-testid={`btn-review-${sub.submittalNumber}`}
                    >
                      Submit Decision
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {submittals.length === 0 && (
              <tr>
                <td colSpan={7} className="empty-cell">
                  No submittal packages recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreateModal && (
        <div className="modal-overlay" data-testid="create-submittal-modal">
          <div className="modal-card">
            <h3>Prepare Submittal Package</h3>
            <form onSubmit={(e) => void handleCreate(e)}>
              <div className="form-group">
                <label>Title *</label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Waterproofing Membrane Sarnafil G410"
                  data-testid="submittal-title-input"
                />
              </div>
              <div className="form-group">
                <label>Submittal Type</label>
                <select
                  value={submittalType}
                  onChange={(e) => setSubmittalType(e.target.value)}
                  data-testid="submittal-type-input"
                >
                  <option value="Material Sample">Material Sample</option>
                  <option value="Shop Drawing">Shop Drawing</option>
                  <option value="Product Data">Product Data</option>
                  <option value="Method Statement">Method Statement</option>
                </select>
              </div>
              <div className="form-group">
                <label>Description / Technical Specification</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Specifications, conformance standard..."
                  data-testid="submittal-description-input"
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Material Trade Name</label>
                  <input
                    type="text"
                    value={itemTradeName}
                    onChange={(e) => setItemTradeName(e.target.value)}
                    placeholder="e.g. Sarnafil G410-12EL"
                    data-testid="submittal-tradename-input"
                  />
                </div>
                <div className="form-group">
                  <label>Manufacturer</label>
                  <input
                    type="text"
                    value={itemManufacturer}
                    onChange={(e) => setItemManufacturer(e.target.value)}
                    placeholder="e.g. Sika AG"
                    data-testid="submittal-manufacturer-input"
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
                  data-testid="submit-create-submittal-btn"
                >
                  {loading ? 'Creating...' : 'Save Draft Submittal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showReviewModal && selectedSubmittal && (
        <div className="modal-overlay" data-testid="review-submittal-modal">
          <div className="modal-card">
            <h3>Maker-Checker Review Decision</h3>
            <p>
              Reviewing <strong>{selectedSubmittal.submittalNumber}</strong>:{' '}
              {selectedSubmittal.title}
            </p>
            <form onSubmit={(e) => void handleReview(e)}>
              <div className="form-group">
                <label>Review Decision Code *</label>
                <select
                  value={decisionCode}
                  onChange={(e) => setDecisionCode(e.target.value as 'A' | 'B' | 'C' | 'D')}
                  data-testid="decision-code-select"
                >
                  <option value="A">Code A: Approved (Phê duyệt không điều kiện)</option>
                  <option value="B">Code B: Approved as Noted (Phê duyệt có ghi chú)</option>
                  <option value="C">Code C: Revise and Resubmit (Yêu cầu chỉnh sửa nộp lại)</option>
                  <option value="D">Code D: Rejected (Từ chối phê duyệt)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Review Remarks & Engineering Comments *</label>
                <textarea
                  required
                  value={reviewComments}
                  onChange={(e) => setReviewComments(e.target.value)}
                  rows={4}
                  placeholder="Record verification notes, code compliance remarks, or reasons for rejection..."
                  data-testid="review-comments-input"
                />
              </div>
              <div className="modal-buttons">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowReviewModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading}
                  data-testid="confirm-review-btn"
                >
                  {loading ? 'Submitting...' : 'Submit Official Review'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
