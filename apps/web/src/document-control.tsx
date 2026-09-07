import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import {
  ApiError,
  type DocumentDetail,
  type DocumentRevision,
  type FileAccessAuthorization,
  type Project,
  type ProjectDocument,
  type ProjectMember,
  type ReviewInboxItem,
  type VinopsApiClient,
} from './api.js';

type Props = {
  client: VinopsApiClient;
  project: Project;
  members: readonly ProjectMember[];
};

type LoadState = 'loading' | 'ready' | 'empty' | 'denied' | 'not-found' | 'error';

function loadState(error: unknown): LoadState {
  if (error instanceof ApiError && error.status === 403) return 'denied';
  if (error instanceof ApiError && error.status === 404) return 'not-found';
  return 'error';
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return `Conflict (${error.code}). Refresh before retrying; no server state was overwritten.`;
  }
  if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
    return 'This document is not visible in your authorized project and resource scope.';
  }
  return error instanceof ApiError
    ? `The server rejected the operation (${error.code}).`
    : 'The operation could not be completed. Existing document state is unchanged.';
}

function deepLink(documentId: string, revisionId?: string): void {
  const hash = new URLSearchParams({ document: documentId });
  if (revisionId !== undefined) hash.set('revision', revisionId);
  globalThis.history.replaceState(null, '', `#${hash.toString()}`);
}

function initialDeepLink(): { documentId?: string; revisionId?: string } {
  const hash = new URLSearchParams(globalThis.location.hash.replace(/^#/u, ''));
  const documentId = hash.get('document') ?? undefined;
  const revisionId = hash.get('revision') ?? undefined;
  return {
    ...(documentId === undefined ? {} : { documentId }),
    ...(revisionId === undefined ? {} : { revisionId }),
  };
}

export function DocumentControlScreen({ client, project, members }: Props) {
  const [documents, setDocuments] = useState<readonly ProjectDocument[]>([]);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [reviewInbox, setReviewInbox] = useState<readonly ReviewInboxItem[]>([]);
  const [search, setSearch] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [state, setState] = useState<LoadState>('loading');
  const [detailState, setDetailState] = useState<LoadState>('empty');
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<FileAccessAuthorization | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [transmittalSnapshot, setTransmittalSnapshot] = useState<Record<string, unknown> | null>(
    null,
  );

  const selectedRevision =
    detail?.exactRevision ?? detail?.currentRevision ?? detail?.revisions[0] ?? null;
  const selectedComments = useMemo(
    () =>
      detail?.reviewComments.filter((comment) => comment.revisionId === selectedRevision?.id) ?? [],
    [detail, selectedRevision?.id],
  );

  useEffect(() => {
    let disposed = false;
    setState('loading');
    setMessage(null);
    void Promise.all([
      client.listDocuments(project.id, search, includeArchived),
      client.listReviewInbox(project.id),
    ])
      .then(([items, inbox]) => {
        if (disposed) return;
        setDocuments(items);
        setReviewInbox(inbox);
        setState(items.length === 0 ? 'empty' : 'ready');
        const link = initialDeepLink();
        if (link.documentId !== undefined) {
          void openDocument(link.documentId, link.revisionId);
        } else if (detail !== null && !items.some((item) => item.id === detail.id)) {
          setDetail(null);
          setDetailState('empty');
        }
      })
      .catch((error: unknown) => {
        if (disposed) return;
        setState(loadState(error));
        setMessage(messageFor(error));
      });
    return () => {
      disposed = true;
    };
  }, [client, includeArchived, project.id, refresh]);

  async function openDocument(documentId: string, revisionId?: string): Promise<void> {
    setDetailState('loading');
    setMessage(null);
    setPreview(null);
    try {
      const next = await client.getDocument(documentId, revisionId);
      setDetail(next);
      setDetailState('ready');
      deepLink(documentId, revisionId);
    } catch (error) {
      setDetail(null);
      setDetailState(loadState(error));
      setMessage(messageFor(error));
    }
  }

  async function perform(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function reloadDetail(revisionId?: string): Promise<void> {
    if (detail === null) return;
    await openDocument(detail.id, revisionId);
    setRefresh((value) => value + 1);
  }

  return (
    <section aria-labelledby="documents-title">
      <p className="eyebrow">Controlled information lifecycle</p>
      <div className="document-heading">
        <div>
          <h2 id="documents-title">Document Control</h2>
          <p className="muted-copy">
            Current is an explicit published pointer. Upload time, filename, and revision code never
            select it.
          </p>
        </div>
        <button
          type="button"
          disabled={state === 'loading'}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
      </div>

      {message === null ? null : (
        <p className="operation-message" role="status">
          {message}
        </p>
      )}

      <div className="document-workspace">
        <aside className="document-sidebar">
          <form
            className="content-card document-search"
            onSubmit={(event) => {
              event.preventDefault();
              setRefresh((value) => value + 1);
            }}
          >
            <label htmlFor="document-search">
              Search code or title
              <input
                id="document-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="checkbox-row" htmlFor="include-archived">
              <input
                checked={includeArchived}
                id="include-archived"
                type="checkbox"
                onChange={(event) => setIncludeArchived(event.target.checked)}
              />
              Include archived
            </label>
            <button type="submit">Apply filters</button>
          </form>

          <DocumentIndex
            documents={documents}
            state={state}
            selectedId={detail?.id}
            onOpen={(documentId) => void openDocument(documentId)}
          />

          <CreateDocumentForm
            busy={busy}
            onCreate={(input) =>
              perform(async () => {
                const created = await client.createDocument({ projectId: project.id, ...input });
                setMessage(`Document ${created.code} created.`);
                setRefresh((value) => value + 1);
                await openDocument(created.id);
              })
            }
          />
        </aside>

        <div className="document-main">
          <ReviewInbox
            busy={busy}
            items={reviewInbox}
            onOpen={(item) => void openDocument(item.documentId, item.revisionId)}
            onDecide={(item, action, reason, comment) =>
              perform(async () => {
                if (comment.body.trim().length > 0) {
                  await client.addReviewComment({
                    revisionId: item.revisionId,
                    importance: comment.importance,
                    body: comment.body.trim(),
                  });
                }
                await client.transitionRevision({
                  revisionId: item.revisionId,
                  action,
                  expectedVersion: item.revisionVersion,
                  reason,
                });
                await openDocument(item.documentId, item.revisionId);
                setRefresh((value) => value + 1);
                setMessage('Review decision recorded as immutable history.');
              })
            }
          />

          {detailState === 'loading' ? (
            <StateCard
              title="Loading document"
              body="Loading current pointer and immutable history…"
            />
          ) : null}
          {detailState === 'empty' ? (
            <StateCard
              title="Choose a document"
              body="Select a visible document or create a new controlled container."
            />
          ) : null}
          {detailState === 'denied' ? (
            <StateCard
              title="Permission denied"
              body="No document metadata or object existence is disclosed for this request."
            />
          ) : null}
          {detailState === 'not-found' ? (
            <StateCard
              title="Document not found"
              body="The deep link is unavailable or outside your authorized scope."
            />
          ) : null}
          {detailState === 'error' ? (
            <StateCard
              title="Partial error"
              body="The document index remains usable. Retry the detail request when the dependency recovers."
            />
          ) : null}

          {detailState === 'ready' && detail !== null ? (
            <>
              <DocumentHeader
                detail={detail}
                selectedRevision={selectedRevision}
                busy={busy}
                onArchive={() => {
                  void perform(async () => {
                    await client.setDocumentArchived(
                      detail.id,
                      detail.archivedAt === undefined,
                      detail.version,
                    );
                    await reloadDetail(selectedRevision?.id);
                  });
                }}
                onOpenCurrent={() => {
                  if (detail.currentRevision !== null)
                    void openDocument(detail.id, detail.currentRevision.id);
                }}
              />

              <RevisionHistory
                detail={detail}
                selectedRevision={selectedRevision}
                onOpen={(revisionId) => void openDocument(detail.id, revisionId)}
              />

              <CreateRevisionForm
                busy={busy}
                progress={uploadProgress}
                onUpload={(input) =>
                  perform(async () => {
                    setUploadProgress(0);
                    try {
                      const revision = await client.createRevisionAndUpload({
                        documentId: detail.id,
                        ...input,
                        onProgress: setUploadProgress,
                      });
                      await openDocument(detail.id, revision.id);
                      setRefresh((value) => value + 1);
                      setMessage(
                        'Upload completed into quarantine. Validation and malware scan are pending.',
                      );
                    } finally {
                      setUploadProgress(null);
                    }
                  })
                }
              />

              {selectedRevision === null ? null : (
                <RevisionActions
                  busy={busy}
                  currentPointerVersion={detail.currentPointerVersion}
                  members={members}
                  revision={selectedRevision}
                  onTransition={(input) =>
                    perform(async () => {
                      await client.transitionRevision({
                        revisionId: selectedRevision.id,
                        ...input,
                      });
                      await reloadDetail(selectedRevision.id);
                      setMessage(`Revision action ${input.action} completed.`);
                    })
                  }
                />
              )}

              {selectedRevision === null ? null : (
                <FileViewer
                  authorization={preview}
                  revision={selectedRevision}
                  annotations={detail.annotations.filter(
                    (item) => item.revisionId === selectedRevision.id,
                  )}
                  busy={busy}
                  onAuthorize={(kind) =>
                    perform(async () => {
                      const authorization = await client.authorizeFileAccess(
                        selectedRevision.id,
                        kind,
                      );
                      if (kind === 'download') {
                        globalThis.location.assign(authorization.url);
                      } else {
                        setPreview(authorization);
                      }
                    })
                  }
                  onAnnotate={(page, x, y, body) =>
                    perform(async () => {
                      await client.addAnnotation({
                        revisionId: selectedRevision.id,
                        page,
                        x,
                        y,
                        body,
                      });
                      await reloadDetail(selectedRevision.id);
                      setMessage('Annotation pin recorded with normalized coordinates.');
                    })
                  }
                />
              )}

              {selectedRevision === null ? null : (
                <CommentDisposition
                  busy={busy}
                  comments={selectedComments}
                  onDispose={(commentId, disposition, response) =>
                    perform(async () => {
                      await client.disposeReviewComment({ commentId, disposition, response });
                      await reloadDetail(selectedRevision.id);
                      setMessage(
                        'Comment disposition recorded; the original comment remains immutable.',
                      );
                    })
                  }
                />
              )}

              <TransmittalForm
                busy={busy}
                revisions={detail.revisions.filter((revision) =>
                  ['Published', 'Superseded'].includes(revision.status),
                )}
                snapshot={transmittalSnapshot}
                onCreate={(input) =>
                  perform(async () => {
                    const snapshot = await client.createTransmittal({
                      projectId: project.id,
                      ...input,
                    });
                    setTransmittalSnapshot(snapshot);
                    setMessage('Immutable transmittal snapshot issued.');
                  })
                }
              />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function StateCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="content-card">
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function DocumentIndex({
  documents,
  state,
  selectedId,
  onOpen,
}: {
  documents: readonly ProjectDocument[];
  state: LoadState;
  selectedId?: string | undefined;
  onOpen: (documentId: string) => void;
}) {
  if (state === 'loading')
    return <StateCard title="Loading documents" body="Loading only server-authorized results…" />;
  if (state === 'denied')
    return (
      <StateCard title="No permission" body="The document count and metadata are not available." />
    );
  if (state === 'error')
    return (
      <StateCard title="Document index unavailable" body="Retry without losing the current form." />
    );
  if (documents.length === 0)
    return <StateCard title="No documents" body="No matching visible documents were returned." />;
  return (
    <ul className="document-list" aria-label="Document list">
      {documents.map((document) => (
        <li key={document.id}>
          <button
            className={selectedId === document.id ? 'document-row is-selected' : 'document-row'}
            type="button"
            onClick={() => onOpen(document.id)}
          >
            <strong>{document.code}</strong>
            <span>{document.title}</span>
            <small>
              {document.archivedAt === undefined ? 'Active' : 'Archived'} · Current:{' '}
              {document.currentRevision?.revisionCode ?? 'None'}
            </small>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CreateDocumentForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (input: { code: string; title: string; documentType: string }) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState('drawing');
  return (
    <form
      className="content-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim() !== '' && title.trim() !== '')
          void onCreate({ code: code.trim(), title: title.trim(), documentType });
      }}
    >
      <h3>Create document</h3>
      <label htmlFor="new-document-code">
        Code
        <input
          id="new-document-code"
          required
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      <label htmlFor="new-document-title">
        Title
        <input
          id="new-document-title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label htmlFor="new-document-type">
        Type
        <select
          id="new-document-type"
          value={documentType}
          onChange={(event) => setDocumentType(event.target.value)}
        >
          <option value="drawing">Drawing</option>
          <option value="procedure">Procedure</option>
          <option value="report">Report</option>
        </select>
      </label>
      <button disabled={busy} type="submit">
        Create controlled container
      </button>
    </form>
  );
}

function DocumentHeader({
  detail,
  selectedRevision,
  busy,
  onArchive,
  onOpenCurrent,
}: {
  detail: DocumentDetail;
  selectedRevision: DocumentRevision | null;
  busy: boolean;
  onArchive: () => void;
  onOpenCurrent: () => void;
}) {
  return (
    <article className="content-card">
      {detail.supersededBanner ? (
        <p className="revision-banner superseded">
          Superseded revision deep link — preserved metadata is shown without redirect.
        </p>
      ) : null}
      {selectedRevision?.status === 'Published' ? (
        <p className="revision-banner current">Published revision</p>
      ) : null}
      <div className="document-heading">
        <div>
          <p className="eyebrow">{detail.code}</p>
          <h3>{detail.title}</h3>
        </div>
        <button className="secondary-button" disabled={busy} type="button" onClick={onArchive}>
          {detail.archivedAt === undefined ? 'Archive' : 'Restore'}
        </button>
      </div>
      <p>
        {detail.documentType} · {detail.confidentiality} · version {detail.version}
      </p>
      {detail.currentLinkAuthorized && detail.currentRevision !== null ? (
        <button type="button" onClick={onOpenCurrent}>
          Open authorized current revision {detail.currentRevision.revisionCode}
        </button>
      ) : null}
    </article>
  );
}

function RevisionHistory({
  detail,
  selectedRevision,
  onOpen,
}: {
  detail: DocumentDetail;
  selectedRevision: DocumentRevision | null;
  onOpen: (revisionId: string) => void;
}) {
  return (
    <article className="content-card">
      <h3>Immutable revision history</h3>
      {detail.revisions.length === 0 ? (
        <p className="muted-copy">No revisions yet.</p>
      ) : (
        <div className="revision-history">
          {detail.revisions.map((revision) => (
            <button
              className={
                selectedRevision?.id === revision.id ? 'revision-item is-selected' : 'revision-item'
              }
              key={revision.id}
              type="button"
              onClick={() => onOpen(revision.id)}
            >
              <strong>{revision.revisionCode}</strong>
              <span>{revision.status}</span>
              <small>
                {revision.file.filename} · {revision.file.status}
              </small>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function CreateRevisionForm({
  busy,
  progress,
  onUpload,
}: {
  busy: boolean;
  progress: number | null;
  onUpload: (input: { revisionCode: string; purpose: string; file: File }) => Promise<void>;
}) {
  const [revisionCode, setRevisionCode] = useState('');
  const [purpose, setPurpose] = useState('For review');
  const [file, setFile] = useState<File | null>(null);
  return (
    <form
      className="content-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (file !== null && revisionCode.trim() !== '')
          void onUpload({ revisionCode: revisionCode.trim(), purpose: purpose.trim(), file });
      }}
    >
      <h3>Create revision and resumable upload</h3>
      <div className="form-grid">
        <label htmlFor="revision-code">
          Revision code
          <input
            id="revision-code"
            required
            value={revisionCode}
            onChange={(event) => setRevisionCode(event.target.value)}
          />
        </label>
        <label htmlFor="revision-purpose">
          Purpose
          <input
            id="revision-purpose"
            required
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </label>
      </div>
      <label htmlFor="revision-file">
        PDF or image
        <input
          accept="application/pdf,image/png,image/jpeg"
          id="revision-file"
          required
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {progress === null ? null : (
        <div>
          <progress max={100} value={progress} />
          <span> {progress}% uploaded to quarantine</span>
        </div>
      )}
      <button disabled={busy || file === null} type="submit">
        Upload revision
      </button>
      <p className="muted-copy">
        Parts retry automatically. Preview and download remain disabled until validation and malware
        scan return Available.
      </p>
    </form>
  );
}

function RevisionActions({
  busy,
  currentPointerVersion,
  members,
  revision,
  onTransition,
}: {
  busy: boolean;
  currentPointerVersion: string;
  members: readonly ProjectMember[];
  revision: DocumentRevision;
  onTransition: (input: {
    action: 'submit_review' | 'publish' | 'withdraw';
    expectedVersion: string;
    expectedCurrentVersion?: string | undefined;
    reason?: string | undefined;
    reviewerIds?: readonly string[] | undefined;
    reviewMode?: 'sequential' | 'quorum' | undefined;
    requiredApprovals?: number | undefined;
  }) => Promise<void>;
}) {
  const [reviewers, setReviewers] = useState<readonly string[]>([]);
  const [mode, setMode] = useState<'sequential' | 'quorum'>('sequential');
  const [reason, setReason] = useState('');
  const eligible = members.filter((member) => member.status === 'Active');
  return (
    <article className="content-card">
      <h3>Revision workflow</h3>
      <p>
        Status: <strong>{revision.status}</strong> · expected version {revision.version}
      </p>
      {revision.status === 'Draft' && revision.file.status === 'Available' ? (
        <>
          <label htmlFor="review-mode">
            Review route
            <select
              id="review-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as 'sequential' | 'quorum')}
            >
              <option value="sequential">Sequential</option>
              <option value="quorum">Quorum</option>
            </select>
          </label>
          <fieldset>
            <legend>Assigned reviewers</legend>
            {eligible.map((member) => (
              <label className="checkbox-row" key={member.id}>
                <input
                  type="checkbox"
                  checked={reviewers.includes(member.userId)}
                  onChange={(event) =>
                    setReviewers((current) =>
                      event.target.checked
                        ? [...current, member.userId]
                        : current.filter((id) => id !== member.userId),
                    )
                  }
                />
                {member.displayName} ({member.roles.join(', ')})
              </label>
            ))}
          </fieldset>
          <button
            disabled={busy || reviewers.length === 0}
            type="button"
            onClick={() =>
              void onTransition({
                action: 'submit_review',
                expectedVersion: revision.version,
                reviewerIds: reviewers,
                reviewMode: mode,
                requiredApprovals:
                  mode === 'quorum' ? Math.ceil(reviewers.length / 2) : reviewers.length,
              })
            }
          >
            Submit for review
          </button>
        </>
      ) : null}
      {['Approved', 'Approved with Comments'].includes(revision.status) ? (
        <button
          disabled={busy}
          type="button"
          onClick={() => {
            if (globalThis.confirm(`Publish revision ${revision.revisionCode} as current?`))
              void onTransition({
                action: 'publish',
                expectedVersion: revision.version,
                expectedCurrentVersion: currentPointerVersion,
              });
          }}
        >
          Publish and switch current atomically
        </button>
      ) : null}
      {['Draft', 'Under Review'].includes(revision.status) ? (
        <div className="inline-action">
          <input
            aria-label="Withdrawal reason"
            placeholder="Required withdrawal reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button
            disabled={busy || reason.trim() === ''}
            type="button"
            onClick={() =>
              void onTransition({
                action: 'withdraw',
                expectedVersion: revision.version,
                reason: reason.trim(),
              })
            }
          >
            Withdraw
          </button>
        </div>
      ) : null}
      {revision.file.status !== 'Available' ? (
        <p className="revision-banner warning">
          File state: {revision.file.status}
          {revision.file.failureCode === undefined ? '' : ` (${revision.file.failureCode})`}.
          Workflow and file access remain guarded.
        </p>
      ) : null}
    </article>
  );
}

function ReviewInbox({
  busy,
  items,
  onOpen,
  onDecide,
}: {
  busy: boolean;
  items: readonly ReviewInboxItem[];
  onOpen: (item: ReviewInboxItem) => void;
  onDecide: (
    item: ReviewInboxItem,
    action: 'approve' | 'approve_with_comments' | 'reject',
    reason: string,
    comment: { importance: 'mandatory' | 'advisory'; body: string },
  ) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string>('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [importance, setImportance] = useState<'mandatory' | 'advisory'>('advisory');
  const item = items.find((candidate) => candidate.assignmentId === selected);
  return (
    <article className="content-card">
      <h3>Review inbox</h3>
      {items.length === 0 ? (
        <p className="muted-copy">No review assignments are visible.</p>
      ) : (
        <>
          <label htmlFor="review-assignment">
            Assignment
            <select
              id="review-assignment"
              value={selected}
              onChange={(event) => {
                setSelected(event.target.value);
                const next = items.find(
                  (candidate) => candidate.assignmentId === event.target.value,
                );
                if (next !== undefined) onOpen(next);
              }}
            >
              <option value="">Choose assignment</option>
              {items.map((entry) => (
                <option key={entry.assignmentId} value={entry.assignmentId}>
                  {entry.documentCode} · {entry.revisionCode} · {entry.decision ?? 'Pending'}
                </option>
              ))}
            </select>
          </label>
          {item === undefined || item.decision !== undefined ? null : (
            <>
              <label htmlFor="review-reason">
                Decision reason
                <input
                  id="review-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label htmlFor="review-importance">
                Comment importance
                <select
                  id="review-importance"
                  value={importance}
                  onChange={(event) =>
                    setImportance(event.target.value as 'mandatory' | 'advisory')
                  }
                >
                  <option value="advisory">Advisory</option>
                  <option value="mandatory">Mandatory</option>
                </select>
              </label>
              <label htmlFor="review-comment">
                Separate review comment
                <textarea
                  id="review-comment"
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              </label>
              <div className="action-row">
                <button
                  disabled={busy}
                  type="button"
                  onClick={() =>
                    void onDecide(
                      item,
                      comment.trim() === '' ? 'approve' : 'approve_with_comments',
                      reason,
                      { importance, body: comment },
                    )
                  }
                >
                  {comment.trim() === '' ? 'Approve' : 'Approve with comments'}
                </button>
                <button
                  disabled={busy || reason.trim() === ''}
                  type="button"
                  onClick={() =>
                    void onDecide(item, 'reject', reason.trim(), { importance, body: comment })
                  }
                >
                  Reject
                </button>
              </div>
            </>
          )}
        </>
      )}
    </article>
  );
}

function FileViewer({
  authorization,
  revision,
  annotations,
  busy,
  onAuthorize,
  onAnnotate,
}: {
  authorization: FileAccessAuthorization | null;
  revision: DocumentRevision;
  annotations: readonly {
    id: string;
    page: number;
    x: number;
    y: number;
    body?: string | undefined;
  }[];
  busy: boolean;
  onAuthorize: (kind: 'preview' | 'download') => Promise<void>;
  onAnnotate: (page: number, x: number, y: number, body: string) => Promise<void>;
}) {
  const [annotationBody, setAnnotationBody] = useState('');
  const [pendingPoint, setPendingPoint] = useState<{ x: number; y: number } | null>(null);
  const available = revision.file.status === 'Available';
  function choosePoint(event: MouseEvent<HTMLDivElement>): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    setPendingPoint({
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    });
  }
  return (
    <article className="content-card">
      <h3>Authorized viewer and annotation</h3>
      <div className="action-row">
        <button
          disabled={busy || !available}
          type="button"
          onClick={() => void onAuthorize('preview')}
        >
          Open short-lived preview
        </button>
        <button
          disabled={busy || !available}
          type="button"
          onClick={() => void onAuthorize('download')}
        >
          Authorized download
        </button>
      </div>
      {!available ? (
        <p className="muted-copy">
          Preview and download are unavailable while the file is {revision.file.status}.
        </p>
      ) : null}
      {authorization === null ? null : (
        <>
          <p className="muted-copy">
            Preview authorization expires at {authorization.expiresAt}. The URL is held only in
            component memory.
          </p>
          <div
            className="viewer-stage"
            role="application"
            aria-label="Page 1 annotation surface"
            onClick={choosePoint}
          >
            {revision.file.mediaType.startsWith('image/') ? (
              <img alt={revision.file.filename} src={authorization.url} />
            ) : (
              <iframe title={`Preview ${revision.file.filename}`} src={authorization.url} />
            )}
            {annotations
              .filter((annotation) => annotation.page === 1)
              .map((annotation) => (
                <span
                  className="annotation-pin"
                  key={annotation.id}
                  style={{ left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%` }}
                  title={annotation.body ?? 'Annotation'}
                />
              ))}
            {pendingPoint === null ? null : (
              <span
                className="annotation-pin pending"
                style={{ left: `${pendingPoint.x * 100}%`, top: `${pendingPoint.y * 100}%` }}
              />
            )}
          </div>
          <div className="inline-action">
            <input
              aria-label="Annotation text"
              placeholder="Click the viewer, then describe the pin"
              value={annotationBody}
              onChange={(event) => setAnnotationBody(event.target.value)}
            />
            <button
              disabled={busy || pendingPoint === null || annotationBody.trim() === ''}
              type="button"
              onClick={() => {
                if (pendingPoint !== null)
                  void onAnnotate(1, pendingPoint.x, pendingPoint.y, annotationBody.trim());
              }}
            >
              Save pin
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function CommentDisposition({
  busy,
  comments,
  onDispose,
}: {
  busy: boolean;
  comments: DocumentDetail['reviewComments'];
  onDispose: (
    commentId: string,
    disposition: 'accepted' | 'incorporated' | 'noted' | 'rejected_with_reason',
    response: string,
  ) => Promise<void>;
}) {
  const unresolved = comments.filter((comment) => comment.dispositionId === undefined);
  const [commentId, setCommentId] = useState('');
  const [disposition, setDisposition] = useState<
    'accepted' | 'incorporated' | 'noted' | 'rejected_with_reason'
  >('incorporated');
  const [response, setResponse] = useState('');
  return (
    <article className="content-card">
      <h3>Review comments and dispositions</h3>
      {comments.length === 0 ? (
        <p className="muted-copy">No comments on this revision.</p>
      ) : (
        <ul>
          {comments.map((comment) => (
            <li key={comment.id}>
              <strong>{comment.importance}</strong>: {comment.body} —{' '}
              {comment.disposition ?? 'unresolved'}
              {comment.response === undefined ? '' : ` (${comment.response})`}
            </li>
          ))}
        </ul>
      )}
      {unresolved.length === 0 ? null : (
        <div className="form-grid">
          <label htmlFor="disposition-comment">
            Unresolved comment
            <select
              id="disposition-comment"
              value={commentId}
              onChange={(event) => setCommentId(event.target.value)}
            >
              <option value="">Choose comment</option>
              {unresolved.map((comment) => (
                <option key={comment.id} value={comment.id}>
                  {comment.importance}: {comment.body}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="disposition-kind">
            Disposition
            <select
              id="disposition-kind"
              value={disposition}
              onChange={(event) => setDisposition(event.target.value as typeof disposition)}
            >
              <option value="incorporated">Incorporated</option>
              <option value="accepted">Accepted</option>
              <option value="noted">Noted</option>
              <option value="rejected_with_reason">Rejected with reason</option>
            </select>
          </label>
          <label htmlFor="disposition-response">
            Response
            <input
              id="disposition-response"
              value={response}
              onChange={(event) => setResponse(event.target.value)}
            />
          </label>
          <button
            disabled={busy || commentId === '' || response.trim() === ''}
            type="button"
            onClick={() => void onDispose(commentId, disposition, response.trim())}
          >
            Record disposition
          </button>
        </div>
      )}
    </article>
  );
}

function TransmittalForm({
  busy,
  revisions,
  snapshot,
  onCreate,
}: {
  busy: boolean;
  revisions: readonly DocumentRevision[];
  snapshot: Record<string, unknown> | null;
  onCreate: (input: {
    code: string;
    purpose: string;
    revisionIds: readonly string[];
    recipientName: string;
    recipientReference: string;
  }) => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [purpose, setPurpose] = useState('For information');
  const [recipientName, setRecipientName] = useState('Synthetic recipient');
  const [recipientReference, setRecipientReference] = useState('recipient-001');
  const [revisionIds, setRevisionIds] = useState<readonly string[]>([]);
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (code.trim() !== '' && revisionIds.length > 0)
      void onCreate({
        code: code.trim(),
        purpose: purpose.trim(),
        revisionIds,
        recipientName: recipientName.trim(),
        recipientReference: recipientReference.trim(),
      });
  }
  return (
    <form className="content-card" onSubmit={submit}>
      <h3>Transmittal snapshot</h3>
      {revisions.length === 0 ? (
        <p className="muted-copy">Publish a revision before issuing a transmittal.</p>
      ) : (
        <fieldset>
          <legend>Published or superseded revisions</legend>
          {revisions.map((revision) => (
            <label className="checkbox-row" key={revision.id}>
              <input
                type="checkbox"
                checked={revisionIds.includes(revision.id)}
                onChange={(event) =>
                  setRevisionIds((current) =>
                    event.target.checked
                      ? [...current, revision.id]
                      : current.filter((id) => id !== revision.id),
                  )
                }
              />
              {revision.revisionCode} · {revision.status} · {revision.file.sha256.slice(0, 12)}…
            </label>
          ))}
        </fieldset>
      )}
      <div className="form-grid">
        <label htmlFor="transmittal-code">
          Code
          <input
            id="transmittal-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </label>
        <label htmlFor="transmittal-purpose">
          Purpose
          <input
            id="transmittal-purpose"
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
          />
        </label>
        <label htmlFor="recipient-name">
          Recipient name
          <input
            id="recipient-name"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
          />
        </label>
        <label htmlFor="recipient-reference">
          Recipient reference
          <input
            id="recipient-reference"
            value={recipientReference}
            onChange={(event) => setRecipientReference(event.target.value)}
          />
        </label>
      </div>
      <button disabled={busy || revisionIds.length === 0} type="submit">
        Issue immutable snapshot
      </button>
      {snapshot === null ? null : (
        <pre className="snapshot-output">{JSON.stringify(snapshot, null, 2)}</pre>
      )}
    </form>
  );
}
