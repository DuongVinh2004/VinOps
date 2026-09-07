export type ApiSession = {
  accessToken: string;
  accessTokenExpiresAt: string;
  csrfToken: string;
  sessionId: string;
  user: {
    id: string;
    displayName: string;
  };
};

export type Organization = {
  id: string;
  code: string;
  name: string;
  status: string;
  version: string;
};

export type Project = {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  timezone: string;
  status: string;
  version: string;
};

export type ProjectMember = {
  id: string;
  userId: string;
  displayName: string;
  roles: readonly string[];
  status: string;
  version: string;
};

export type DocumentFile = {
  id: string;
  status: string;
  filename: string;
  sizeBytes: string;
  mediaType: string;
  sha256: string;
  failureCode?: string | undefined;
};

export type DocumentRevision = {
  id: string;
  documentId: string;
  revisionCode: string;
  purpose: string;
  suitabilityCode?: string | undefined;
  status: string;
  version: string;
  createdBy: string;
  createdAt: string;
  publishedAt?: string | undefined;
  supersededAt?: string | undefined;
  file: DocumentFile;
};

export type ProjectDocument = {
  id: string;
  projectId: string;
  numberingContext: string;
  code: string;
  title: string;
  documentType: string;
  confidentiality: string;
  version: string;
  archivedAt?: string | undefined;
  currentRevision: DocumentRevision | null;
  locationId?: string | undefined;
  disciplineId?: string | undefined;
  classificationId?: string | undefined;
  workId?: string | undefined;
};

export type DocumentDetail = ProjectDocument & {
  revisions: readonly DocumentRevision[];
  exactRevision: DocumentRevision | null;
  supersededBanner: boolean;
  currentLinkAuthorized: boolean;
  currentPointerVersion: string;
  allowedActions: readonly string[];
  reviewComments: readonly DocumentReviewComment[];
  annotations: readonly DocumentAnnotation[];
};

export type DocumentReviewComment = {
  id: string;
  revisionId: string;
  importance: 'mandatory' | 'advisory';
  body: string;
  dispositionId?: string | undefined;
  disposition?: string | undefined;
  response?: string | undefined;
};

export type DocumentAnnotation = {
  id: string;
  revisionId: string;
  page: number;
  x: number;
  y: number;
  kind: string;
  body?: string | undefined;
};

export type ReviewInboxItem = {
  assignmentId: string;
  revisionId: string;
  revisionCode: string;
  revisionStatus: string;
  revisionVersion: string;
  documentId: string;
  documentCode: string;
  title: string;
  decision?: string | undefined;
};

export type FileAccessAuthorization = {
  url: string;
  expiresAt: string;
  filename: string;
};

export type ContextEntity = {
  id: string;
  code?: string;
  name: string;
  parentId?: string;
  status: string;
};

export type ProjectContext = {
  calendars: readonly ContextEntity[];
  classifications: readonly ContextEntity[];
  disciplines: readonly ContextEntity[];
  locationNodes: readonly ContextEntity[];
  numberingProfiles: readonly ContextEntity[];
  partners: readonly ContextEntity[];
  workNodes: readonly ContextEntity[];
};

type Fetcher = typeof fetch;
type JsonRecord = Record<string, unknown>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError(502, `INVALID_API_RESPONSE_${field.toUpperCase()}`, false);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new ApiError(502, 'INVALID_API_RESPONSE', false);
  }
  return value;
}

function toOrganization(value: unknown): Organization {
  const record = asRecord(value);
  return {
    id: requiredString(record.id, 'organization_id'),
    code: requiredString(record.code, 'organization_code'),
    name: requiredString(record.name, 'organization_name'),
    status: requiredString(record.status, 'organization_status'),
    version: requiredString(record.version, 'organization_version'),
  };
}

function toProject(value: unknown): Project {
  const record = asRecord(value);
  return {
    id: requiredString(record.id, 'project_id'),
    organizationId: requiredString(record.organization_id, 'project_organization_id'),
    code: requiredString(record.code, 'project_code'),
    name: requiredString(record.name, 'project_name'),
    timezone: requiredString(record.timezone, 'project_timezone'),
    status: requiredString(record.status, 'project_status'),
    version: requiredString(record.version, 'project_version'),
  };
}

function toMember(value: unknown): ProjectMember {
  const record = asRecord(value);
  return {
    id: requiredString(record.id, 'membership_id'),
    userId: requiredString(record.user_id, 'membership_user_id'),
    displayName: requiredString(record.display_name, 'membership_display_name'),
    roles: stringArray(record.roles),
    status: requiredString(record.status, 'membership_status'),
    version: requiredString(record.version, 'membership_version'),
  };
}

function nullableString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function toRevision(value: unknown): DocumentRevision {
  const record = asRecord(value);
  const file = asRecord(record.file);
  return {
    id: requiredString(record.id, 'revision_id'),
    documentId: requiredString(record.document_id, 'revision_document_id'),
    revisionCode: requiredString(record.revision_code, 'revision_code'),
    purpose: requiredString(record.purpose, 'revision_purpose'),
    status: requiredString(record.status, 'revision_status'),
    version: requiredString(record.version, 'revision_version'),
    createdBy: requiredString(record.created_by, 'revision_creator'),
    createdAt: requiredString(record.created_at, 'revision_created_at'),
    file: {
      id: requiredString(file.id, 'revision_file_id'),
      status: requiredString(file.status, 'revision_file_status'),
      filename: requiredString(file.filename, 'revision_filename'),
      sizeBytes: requiredString(file.size_bytes, 'revision_file_size'),
      mediaType: requiredString(file.media_type, 'revision_file_media_type'),
      sha256: requiredString(file.sha256, 'revision_file_sha256'),
      ...(nullableString(file.failure_code) === undefined
        ? {}
        : { failureCode: nullableString(file.failure_code) }),
    },
    ...(nullableString(record.suitability_code) === undefined
      ? {}
      : { suitabilityCode: nullableString(record.suitability_code) }),
    ...(nullableString(record.published_at) === undefined
      ? {}
      : { publishedAt: nullableString(record.published_at) }),
    ...(nullableString(record.superseded_at) === undefined
      ? {}
      : { supersededAt: nullableString(record.superseded_at) }),
  };
}

function toDocument(value: unknown): ProjectDocument {
  const record = asRecord(value);
  return {
    id: requiredString(record.id, 'document_id'),
    projectId: requiredString(record.project_id, 'document_project_id'),
    numberingContext: requiredString(record.numbering_context, 'document_numbering_context'),
    code: requiredString(record.code, 'document_code'),
    title: requiredString(record.title, 'document_title'),
    documentType: requiredString(record.document_type, 'document_type'),
    confidentiality: requiredString(record.confidentiality, 'document_confidentiality'),
    version: requiredString(record.version, 'document_version'),
    currentRevision: record.current_revision === null ? null : toRevision(record.current_revision),
    ...(nullableString(record.archived_at) === undefined
      ? {}
      : { archivedAt: nullableString(record.archived_at) }),
    ...(nullableString(record.location_id) === undefined
      ? {}
      : { locationId: nullableString(record.location_id) }),
    ...(nullableString(record.discipline_id) === undefined
      ? {}
      : { disciplineId: nullableString(record.discipline_id) }),
    ...(nullableString(record.classification_id) === undefined
      ? {}
      : { classificationId: nullableString(record.classification_id) }),
    ...(nullableString(record.work_id) === undefined
      ? {}
      : { workId: nullableString(record.work_id) }),
  };
}

function toDocumentDetail(value: unknown): DocumentDetail {
  const record = asRecord(value);
  const base = toDocument(record);
  return {
    ...base,
    revisions: Array.isArray(record.revisions) ? record.revisions.map(toRevision) : [],
    exactRevision: record.exact_revision === null ? null : toRevision(record.exact_revision),
    supersededBanner: record.superseded_banner === true,
    currentLinkAuthorized: record.current_link_authorized === true,
    currentPointerVersion: requiredString(
      record.current_pointer_version,
      'current_pointer_version',
    ),
    allowedActions: stringArray(record.allowed_actions),
    reviewComments: Array.isArray(record.review_comments)
      ? record.review_comments.map((value) => {
          const comment = asRecord(value);
          const importance = requiredString(comment.importance, 'review_comment_importance');
          if (importance !== 'mandatory' && importance !== 'advisory') {
            throw new ApiError(502, 'INVALID_API_RESPONSE_REVIEW_COMMENT_IMPORTANCE', false);
          }
          return {
            id: requiredString(comment.id, 'review_comment_id'),
            revisionId: requiredString(comment.revision_id, 'review_comment_revision_id'),
            importance,
            body: requiredString(comment.body, 'review_comment_body'),
            ...(nullableString(comment.disposition_id) === undefined
              ? {}
              : { dispositionId: nullableString(comment.disposition_id) }),
            ...(nullableString(comment.disposition) === undefined
              ? {}
              : { disposition: nullableString(comment.disposition) }),
            ...(nullableString(comment.response) === undefined
              ? {}
              : { response: nullableString(comment.response) }),
          };
        })
      : [],
    annotations: Array.isArray(record.annotations)
      ? record.annotations.map((value) => {
          const annotation = asRecord(value);
          const page = Number(annotation.page);
          const x = Number(annotation.x);
          const y = Number(annotation.y);
          if (!Number.isInteger(page) || !Number.isFinite(x) || !Number.isFinite(y)) {
            throw new ApiError(502, 'INVALID_API_RESPONSE_ANNOTATION', false);
          }
          return {
            id: requiredString(annotation.id, 'annotation_id'),
            revisionId: requiredString(annotation.revision_id, 'annotation_revision_id'),
            page,
            x,
            y,
            kind: requiredString(annotation.kind, 'annotation_kind'),
            ...(nullableString(annotation.body) === undefined
              ? {}
              : { body: nullableString(annotation.body) }),
          };
        })
      : [],
  };
}

function toReviewInboxItem(value: unknown): ReviewInboxItem {
  const record = asRecord(value);
  return {
    assignmentId: requiredString(record.assignment_id, 'review_assignment_id'),
    revisionId: requiredString(record.revision_id, 'review_revision_id'),
    revisionCode: requiredString(record.revision_code, 'review_revision_code'),
    revisionStatus: requiredString(record.status, 'review_revision_status'),
    revisionVersion: requiredString(record.version, 'review_revision_version'),
    documentId: requiredString(record.document_id, 'review_document_id'),
    documentCode: requiredString(record.document_code, 'review_document_code'),
    title: requiredString(record.title, 'review_document_title'),
    ...(nullableString(record.decision) === undefined
      ? {}
      : { decision: nullableString(record.decision) }),
  };
}

function toContextEntity(value: unknown): ContextEntity {
  const record = asRecord(value);
  const code = optionalString(record.code);
  const parentId = optionalString(record.parent_id);
  return {
    id: requiredString(record.id, 'context_id'),
    name: requiredString(record.name, 'context_name'),
    status: requiredString(record.status, 'context_status'),
    ...(code === undefined ? {} : { code }),
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function pageItems(value: unknown): readonly unknown[] {
  const page = asRecord(value);
  return Array.isArray(page.items) ? page.items : [];
}

function sessionFromResponse(value: unknown): ApiSession {
  const record = asRecord(value);
  const user = asRecord(record.user);
  return {
    accessToken: requiredString(record.access_token, 'access_token'),
    accessTokenExpiresAt: requiredString(record.access_token_expires_at, 'access_token_expires_at'),
    csrfToken: requiredString(record.csrf_token, 'csrf_token'),
    sessionId: requiredString(record.session_id, 'session_id'),
    user: {
      id: requiredString(user.id, 'user_id'),
      displayName: requiredString(user.display_name, 'user_display_name'),
    },
  };
}

function contextItems(value: unknown, field: string): readonly ContextEntity[] {
  const record = asRecord(value);
  const items = record[field];
  return Array.isArray(items) ? items.map(toContextEntity) : [];
}

function createUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/u, '')}/${path.replace(/^\//u, '')}`;
}

function createIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid === undefined
    ? `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
    : `web-${uuid}`;
}

type RequestOptions = {
  authenticated?: boolean;
  retryOnUnauthorized?: boolean;
};

/**
 * Browser-only API boundary. The refresh token is never exposed here: fetch sends the
 * HttpOnly cookie with `credentials: include`, while access and CSRF tokens remain in this object.
 */
export class VinopsApiClient {
  private session: ApiSession | null = null;
  private refreshInFlight: Promise<ApiSession> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  ) {}

  getSession(): ApiSession | null {
    return this.session;
  }

  setSession(session: ApiSession | null): void {
    this.session = session;
  }

  async login(email: string, password: string): Promise<ApiSession> {
    const response = await this.request<unknown>(
      'auth/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, device_name: 'vinops-web' }),
      },
      { authenticated: false, retryOnUnauthorized: false },
    );
    this.session = sessionFromResponse(response);
    return this.session;
  }

  async refresh(): Promise<ApiSession> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }
    const refresh = this.performRefresh();
    this.refreshInFlight = refresh;
    try {
      return await refresh;
    } finally {
      if (this.refreshInFlight === refresh) {
        this.refreshInFlight = null;
      }
    }
  }

  private async performRefresh(): Promise<ApiSession> {
    const csrfToken = this.session?.csrfToken;
    if (csrfToken === undefined) {
      throw new ApiError(401, 'REFRESH_CONTEXT_MISSING', false);
    }
    const response = await this.request<unknown>(
      'auth/refresh',
      { method: 'POST', headers: { 'x-csrf-token': csrfToken } },
      { authenticated: false, retryOnUnauthorized: false },
    );
    this.session = sessionFromResponse(response);
    return this.session;
  }

  async signOut(): Promise<void> {
    try {
      await this.request<void>(
        'auth/sessions',
        { method: 'DELETE' },
        { retryOnUnauthorized: false },
      );
    } finally {
      this.session = null;
    }
  }

  async listOrganizations(): Promise<readonly Organization[]> {
    return this.organizationsFromResponse(await this.request<unknown>('organizations'));
  }

  async listProjects(organizationId: string): Promise<readonly Project[]> {
    const response = await this.request<unknown>(
      `organizations/${encodeURIComponent(organizationId)}/projects`,
    );
    return pageItems(response).map(toProject);
  }

  async getProject(projectId: string): Promise<Project> {
    return toProject(await this.request<unknown>(`projects/${encodeURIComponent(projectId)}`));
  }

  async listMembers(projectId: string): Promise<readonly ProjectMember[]> {
    const response = await this.request<unknown>(
      `projects/${encodeURIComponent(projectId)}/members`,
    );
    return pageItems(response).map(toMember);
  }

  async getProjectContext(projectId: string): Promise<ProjectContext> {
    const response = await this.request<unknown>(
      `projects/${encodeURIComponent(projectId)}/context`,
    );
    return {
      calendars: contextItems(response, 'calendars'),
      classifications: contextItems(response, 'classifications'),
      disciplines: contextItems(response, 'disciplines'),
      locationNodes: contextItems(response, 'location_nodes'),
      numberingProfiles: contextItems(response, 'numbering_profiles'),
      partners: contextItems(response, 'partners'),
      workNodes: contextItems(response, 'work_nodes'),
    };
  }

  async createInvitation(input: {
    projectId: string;
    email: string;
    roles: readonly string[];
    scopes: readonly Record<string, unknown>[];
    validTo: string;
  }): Promise<void> {
    await this.request<unknown>(`projects/${encodeURIComponent(input.projectId)}/invitations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': createIdempotencyKey(),
      },
      body: JSON.stringify({
        email: input.email,
        roles: input.roles,
        scopes: input.scopes,
        valid_to: input.validTo,
      }),
    });
  }

  async listDocuments(
    projectId: string,
    search = '',
    includeArchived = false,
    filters?: {
      locationId?: string | undefined;
      disciplineId?: string | undefined;
      workId?: string | undefined;
      documentType?: string | undefined;
    },
  ): Promise<readonly ProjectDocument[]> {
    const query = new URLSearchParams({
      search,
      include_archived: String(includeArchived),
    });
    if (filters?.locationId) query.set('location_id', filters.locationId);
    if (filters?.disciplineId) query.set('discipline_id', filters.disciplineId);
    if (filters?.workId) query.set('work_id', filters.workId);
    if (filters?.documentType) query.set('document_type', filters.documentType);
    const response = await this.request<unknown>(
      `projects/${encodeURIComponent(projectId)}/documents?${query.toString()}`,
    );
    return pageItems(response).map(toDocument);
  }

  async createDocument(input: {
    projectId: string;
    code: string;
    title: string;
    documentType: string;
    numberingContext?: string | undefined;
    locationId?: string | undefined;
    disciplineId?: string | undefined;
    classificationId?: string | undefined;
    workId?: string | undefined;
  }): Promise<ProjectDocument> {
    return toDocument(
      await this.request<unknown>(`projects/${encodeURIComponent(input.projectId)}/documents`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify({
          code: input.code,
          title: input.title,
          document_type: input.documentType,
          numbering_context: input.numberingContext ?? 'default',
          ...(input.locationId ? { location_id: input.locationId } : {}),
          ...(input.disciplineId ? { discipline_id: input.disciplineId } : {}),
          ...(input.classificationId ? { classification_id: input.classificationId } : {}),
          ...(input.workId ? { work_id: input.workId } : {}),
        }),
      }),
    );
  }

  async getDocument(documentId: string, revisionId?: string): Promise<DocumentDetail> {
    const suffix = revisionId === undefined ? '' : `?revision_id=${encodeURIComponent(revisionId)}`;
    return toDocumentDetail(
      await this.request<unknown>(`documents/${encodeURIComponent(documentId)}${suffix}`),
    );
  }

  async createRevisionAndUpload(input: {
    documentId: string;
    revisionCode: string;
    purpose: string;
    suitabilityCode?: string | undefined;
    file: File;
    onProgress?: ((percentage: number) => void) | undefined;
  }): Promise<DocumentRevision> {
    const bytes = new Uint8Array(await input.file.arrayBuffer());
    const checksum = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const created = asRecord(
      await this.request<unknown>(`documents/${encodeURIComponent(input.documentId)}/revisions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify({
          revision_code: input.revisionCode,
          purpose: input.purpose,
          suitability_code: input.suitabilityCode,
          file: {
            filename: input.file.name,
            size_bytes: input.file.size,
            media_type: input.file.type,
            sha256: checksum,
          },
        }),
      }),
    );
    const revision = toRevision(created.revision);
    const session = asRecord(created.upload_session);
    const sessionId = requiredString(session.id, 'upload_session_id');
    const chunkSize = Number(session.chunk_size_bytes);
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 5_242_880) {
      throw new ApiError(502, 'INVALID_API_RESPONSE_UPLOAD_CHUNK_SIZE', false);
    }
    const parts: Array<{ part_number: number; etag: string }> = [];
    for (
      let offset = 0, partNumber = 1;
      offset < bytes.length;
      offset += chunkSize, partNumber += 1
    ) {
      const end = Math.min(bytes.length, offset + chunkSize);
      const part = bytes.slice(offset, end);
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const authorization = asRecord(
          await this.request<unknown>(
            `upload-sessions/${encodeURIComponent(sessionId)}/parts/${partNumber}/authorization`,
            { method: 'POST' },
          ),
        );
        const url = requiredString(authorization.url, 'upload_part_url');
        response = await this.fetcher(url, { method: 'PUT', body: part });
        if (response.ok) break;
      }
      if (response === undefined || !response.ok) {
        throw new ApiError(response?.status ?? 503, 'UPLOAD_PART_FAILED', true);
      }
      const etag = response.headers.get('etag');
      if (etag === null) throw new ApiError(502, 'UPLOAD_PART_ETAG_MISSING', false);
      parts.push({ part_number: partNumber, etag });
      input.onProgress?.(Math.round((end / bytes.length) * 100));
    }
    await this.request<unknown>(`upload-sessions/${encodeURIComponent(sessionId)}/complete`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': createIdempotencyKey(),
      },
      body: JSON.stringify({
        completed_parts: parts,
        size_bytes: input.file.size,
        sha256: checksum,
      }),
    });
    return revision;
  }

  async listReviewInbox(projectId: string): Promise<readonly ReviewInboxItem[]> {
    const response = await this.request<unknown>(
      `projects/${encodeURIComponent(projectId)}/review-inbox`,
    );
    return pageItems(response).map(toReviewInboxItem);
  }

  async transitionRevision(input: {
    revisionId: string;
    action:
      'submit_review' | 'approve' | 'approve_with_comments' | 'reject' | 'publish' | 'withdraw';
    expectedVersion: string;
    expectedCurrentVersion?: string | undefined;
    reason?: string | undefined;
    reviewerIds?: readonly string[] | undefined;
    reviewMode?: 'sequential' | 'quorum' | undefined;
    requiredApprovals?: number | undefined;
  }): Promise<DocumentRevision> {
    return toRevision(
      await this.request<unknown>(`revisions/${encodeURIComponent(input.revisionId)}/transitions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify({
          action: input.action,
          expected_version: input.expectedVersion,
          expected_current_version: input.expectedCurrentVersion,
          reason: input.reason,
          reviewer_ids: input.reviewerIds,
          review_mode: input.reviewMode,
          required_approvals: input.requiredApprovals,
        }),
      }),
    );
  }

  async addReviewComment(input: {
    revisionId: string;
    importance: 'mandatory' | 'advisory';
    body: string;
  }): Promise<void> {
    await this.request<unknown>(`revisions/${encodeURIComponent(input.revisionId)}/comments`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': createIdempotencyKey(),
      },
      body: JSON.stringify({ importance: input.importance, body: input.body }),
    });
  }

  async disposeReviewComment(input: {
    commentId: string;
    disposition: 'accepted' | 'incorporated' | 'noted' | 'rejected_with_reason';
    response: string;
  }): Promise<void> {
    await this.request<unknown>(
      `review-comments/${encodeURIComponent(input.commentId)}/dispositions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify({ disposition: input.disposition, response: input.response }),
      },
    );
  }

  async addAnnotation(input: {
    revisionId: string;
    page: number;
    x: number;
    y: number;
    body: string;
  }): Promise<void> {
    await this.request<unknown>(`revisions/${encodeURIComponent(input.revisionId)}/annotations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': createIdempotencyKey(),
      },
      body: JSON.stringify({
        page: input.page,
        x: input.x,
        y: input.y,
        kind: 'pin',
        body: input.body,
      }),
    });
  }

  async authorizeFileAccess(
    revisionId: string,
    kind: 'preview' | 'download',
  ): Promise<FileAccessAuthorization> {
    const response = asRecord(
      await this.request<unknown>(`revisions/${encodeURIComponent(revisionId)}/${kind}`),
    );
    return {
      url: requiredString(response.url, 'file_access_url'),
      expiresAt: requiredString(response.expires_at, 'file_access_expiry'),
      filename: requiredString(response.filename, 'file_access_filename'),
    };
  }

  async createTransmittal(input: {
    projectId: string;
    code: string;
    purpose: string;
    revisionIds: readonly string[];
    recipientName: string;
    recipientReference: string;
  }): Promise<JsonRecord> {
    return asRecord(
      await this.request<unknown>(`projects/${encodeURIComponent(input.projectId)}/transmittals`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify({
          code: input.code,
          purpose: input.purpose,
          items: input.revisionIds.map((revisionId) => ({ revision_id: revisionId })),
          recipients: [
            {
              type: 'external',
              reference: input.recipientReference,
              name: input.recipientName,
            },
          ],
        }),
      }),
    );
  }

  async setDocumentArchived(
    documentId: string,
    archived: boolean,
    expectedVersion: string,
  ): Promise<ProjectDocument> {
    return toDocument(
      await this.request<unknown>(
        `documents/${encodeURIComponent(documentId)}/${archived ? 'archive' : 'restore'}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': createIdempotencyKey(),
          },
          body: JSON.stringify({ expected_version: expectedVersion }),
        },
      ),
    );
  }

  private organizationsFromResponse(value: unknown): readonly Organization[] {
    return pageItems(value).map(toOrganization);
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    options: RequestOptions = {},
  ): Promise<T> {
    const authenticated = options.authenticated ?? true;
    const retryOnUnauthorized = options.retryOnUnauthorized ?? authenticated;
    const response = await this.send(path, init, authenticated);
    if (response.status === 401 && retryOnUnauthorized && this.session !== null) {
      try {
        await this.refresh();
      } catch {
        this.session = null;
        throw await this.toApiError(response);
      }
      return this.request<T>(path, init, { authenticated, retryOnUnauthorized: false });
    }
    if (!response.ok) {
      throw await this.toApiError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  private async send(path: string, init: RequestInit, authenticated: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (authenticated && this.session !== null) {
      headers.set('authorization', `Bearer ${this.session.accessToken}`);
    }
    return this.fetcher(createUrl(this.baseUrl, path), {
      ...init,
      headers,
      credentials: 'include',
    });
  }

  private async toApiError(response: Response): Promise<ApiError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const record = isRecord(body) ? body : {};
    return new ApiError(
      response.status,
      typeof record.code === 'string' ? record.code : `HTTP_${response.status}`,
      record.retryable === true,
    );
  }
}
