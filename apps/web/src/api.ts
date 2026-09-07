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

export type FieldIssue = {
  id: string;
  organizationId: string;
  projectId: string;
  issueNumber: string;
  title: string;
  description: string;
  status: 'Open' | 'Under Triage' | 'Assigned' | 'In Progress' | 'Resolved' | 'Closed';
  severity: 'Low' | 'Medium' | 'High' | 'Critical';
  locationNodeId?: string;
  workNodeId?: string;
  contractorOrganizationId?: string;
  assignedToUserId?: string;
  gpsLat?: number;
  gpsLng?: number;
  rfiId?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
};

export type RfiRequest = {
  id: string;
  organizationId: string;
  projectId: string;
  rfiNumber: string;
  title: string;
  question: string;
  status:
    | 'Draft'
    | 'Submitted'
    | 'Under Review'
    | 'Clarification Required'
    | 'Official Answered'
    | 'Closed';
  priority: 'Low' | 'Normal' | 'High' | 'Urgent';
  ballInCourtOrganizationId?: string;
  dueDate?: string;
  leadContractorPartnerOrganizationId?: string;
  consultantPartnerOrganizationId?: string;
  locationNodeId?: string;
  workNodeId?: string;
  sourceIssueId?: string;
  costImpact?: boolean;
  scheduleImpact?: boolean;
  version: string;
  createdAt: string;
  updatedAt: string;
};

export type Submittal = {
  id: string;
  organizationId: string;
  projectId: string;
  submittalNumber: string;
  title: string;
  description?: string;
  submittalType: string;
  status:
    | 'Draft'
    | 'Submitted'
    | 'Under Review'
    | 'Approved'
    | 'Approved as Noted'
    | 'Revise and Resubmit'
    | 'Rejected';
  makerPartnerOrganizationId: string;
  leadContractorPartnerOrganizationId?: string;
  consultantPartnerOrganizationId?: string;
  ballInCourtOrganizationId?: string;
  reviewDecisionCode?: string;
  reviewRemarks?: string;
  dueDate?: string;
  version: string;
  createdAt: string;
  updatedAt: string;
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

export type ChecklistItem = {
  id: string;
  templateId: string;
  itemKey: string;
  title: string;
  description?: string;
  sequence: number;
  isMandatory: boolean;
  requiresEvidence: boolean;
  criterionType: 'pass_fail' | 'measurement' | 'text';
  unit?: string;
  minValue?: number;
  maxValue?: number;
};

export type InspectionTemplate = {
  id: string;
  projectId: string;
  code: string;
  name: string;
  category: string;
  checklistItems?: readonly ChecklistItem[];
};

export type ChecklistResult = {
  id: string;
  checklistItemId: string;
  result: 'Pass' | 'Fail' | 'NA' | 'Pending';
  measurementValue?: number;
  remarks?: string;
  evidenceFileIds?: readonly string[];
};

export type Inspection = {
  id: string;
  projectId: string;
  templateId?: string;
  code: string;
  title: string;
  status: string;
  inspectionDate: string;
  notes?: string;
  results?: readonly ChecklistResult[];
};

export type AcceptanceRecord = {
  id: string;
  projectId: string;
  code: string;
  recordType: string;
  legalBasis: string;
  result: string;
  status: string;
  contractorSignedBy?: string;
  contractorSignedAt?: string;
  supervisorSignedBy?: string;
  supervisorSignedAt?: string;
  pmuSignedBy?: string;
  pmuSignedAt?: string;
  conditionsNotes?: string;
  recordedAt: string;
};

export type DailyManpower = {
  id: string;
  dailyLogId: string;
  tradeOrSubcontractor: string;
  skillLevel: string;
  headcount: number;
  hoursWorked: number;
  notes?: string;
};

export type DailyEquipment = {
  id: string;
  dailyLogId: string;
  equipmentName: string;
  equipmentType: string;
  quantity: number;
  hoursWorked: number;
  operationalStatus: string;
  notes?: string;
};

export type DailyWeather = {
  id: string;
  dailyLogId: string;
  timeOfDay: 'morning' | 'noon' | 'afternoon';
  temperatureC: number;
  weatherCondition: string;
  rainfallMm: number;
  windForce: string;
  gpsLat?: number;
  gpsLng?: number;
  source: 'manual' | 'crawled';
  notes?: string;
};

export type DailyLog = {
  id: string;
  projectId: string;
  contractPackageId: string;
  logDate: string;
  shiftCode: string;
  status: 'Draft' | 'Submitted' | 'Confirmed' | 'Amended';
  authorUnit: string;
  workSummary?: string;
  notes?: string;
  siteManagerSignedBy?: string;
  siteManagerSignedAt?: string;
  supervisorSignedBy?: string;
  supervisorSignedAt?: string;
  manpower?: readonly DailyManpower[];
  equipment?: readonly DailyEquipment[];
  weather?: readonly DailyWeather[];
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
  };
}

function toFieldIssue(value: unknown): FieldIssue {
  const row = asRecord(value);
  const locationNodeId = optionalString(row.location_node_id);
  const workNodeId = optionalString(row.work_node_id);
  const contractorOrganizationId = optionalString(row.contractor_organization_id);
  const assignedToUserId = optionalString(row.assigned_to_user_id);
  const rfiId = optionalString(row.rfi_id);

  return {
    id: requiredString(row.id, 'issue_id'),
    organizationId: requiredString(row.organization_id, 'organization_id'),
    projectId: requiredString(row.project_id, 'project_id'),
    issueNumber: requiredString(row.issue_number, 'issue_number'),
    title: requiredString(row.title, 'title'),
    description: requiredString(row.description, 'description'),
    status: (row.status as FieldIssue['status']) ?? 'Open',
    severity: (row.severity as FieldIssue['severity']) ?? 'Medium',
    ...(locationNodeId !== undefined ? { locationNodeId } : {}),
    ...(workNodeId !== undefined ? { workNodeId } : {}),
    ...(contractorOrganizationId !== undefined ? { contractorOrganizationId } : {}),
    ...(assignedToUserId !== undefined ? { assignedToUserId } : {}),
    ...(row.gps_lat !== null && row.gps_lat !== undefined ? { gpsLat: Number(row.gps_lat) } : {}),
    ...(row.gps_lng !== null && row.gps_lng !== undefined ? { gpsLng: Number(row.gps_lng) } : {}),
    ...(rfiId !== undefined ? { rfiId } : {}),
    version: optionalString(row.version) ?? '1',
    createdAt: optionalString(row.created_at) ?? '',
    updatedAt: optionalString(row.updated_at) ?? '',
  };
}

function toRfiRequest(value: unknown): RfiRequest {
  const row = asRecord(value);
  const ballInCourtOrganizationId = optionalString(row.ball_in_court_organization_id);
  const dueDate = optionalString(row.due_date);
  const leadContractorPartnerOrganizationId = optionalString(
    row.lead_contractor_partner_organization_id,
  );
  const consultantPartnerOrganizationId = optionalString(row.consultant_partner_organization_id);
  const locationNodeId = optionalString(row.location_node_id);
  const workNodeId = optionalString(row.work_node_id);
  const sourceIssueId = optionalString(row.source_issue_id);

  return {
    id: requiredString(row.id, 'rfi_id'),
    organizationId: requiredString(row.organization_id, 'organization_id'),
    projectId: requiredString(row.project_id, 'project_id'),
    rfiNumber: requiredString(row.rfi_number, 'rfi_number'),
    title: requiredString(row.title, 'title'),
    question: requiredString(row.question, 'question'),
    status: (row.status as RfiRequest['status']) ?? 'Draft',
    priority: (row.priority as RfiRequest['priority']) ?? 'Normal',
    ...(ballInCourtOrganizationId !== undefined ? { ballInCourtOrganizationId } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    ...(leadContractorPartnerOrganizationId !== undefined
      ? { leadContractorPartnerOrganizationId }
      : {}),
    ...(consultantPartnerOrganizationId !== undefined ? { consultantPartnerOrganizationId } : {}),
    ...(locationNodeId !== undefined ? { locationNodeId } : {}),
    ...(workNodeId !== undefined ? { workNodeId } : {}),
    ...(sourceIssueId !== undefined ? { sourceIssueId } : {}),
    costImpact: Boolean(row.cost_impact),
    scheduleImpact: Boolean(row.schedule_impact),
    version: optionalString(row.version) ?? '1',
    createdAt: optionalString(row.created_at) ?? '',
    updatedAt: optionalString(row.updated_at) ?? '',
  };
}

function toSubmittal(value: unknown): Submittal {
  const row = asRecord(value);
  const description = optionalString(row.description);
  const leadContractorPartnerOrganizationId = optionalString(
    row.lead_contractor_partner_organization_id,
  );
  const consultantPartnerOrganizationId = optionalString(row.consultant_partner_organization_id);
  const ballInCourtOrganizationId = optionalString(row.ball_in_court_organization_id);
  const reviewDecisionCode = optionalString(row.review_decision_code);
  const reviewRemarks = optionalString(row.review_remarks);
  const dueDate = optionalString(row.due_date);

  return {
    id: requiredString(row.id, 'submittal_id'),
    organizationId: requiredString(row.organization_id, 'organization_id'),
    projectId: requiredString(row.project_id, 'project_id'),
    submittalNumber: requiredString(row.submittal_number, 'submittal_number'),
    title: requiredString(row.title, 'title'),
    submittalType: requiredString(row.submittal_type, 'submittal_type'),
    status: (row.status as Submittal['status']) ?? 'Draft',
    makerPartnerOrganizationId: requiredString(
      row.maker_partner_organization_id,
      'maker_partner_organization_id',
    ),
    ...(description !== undefined ? { description } : {}),
    ...(leadContractorPartnerOrganizationId !== undefined
      ? { leadContractorPartnerOrganizationId }
      : {}),
    ...(consultantPartnerOrganizationId !== undefined ? { consultantPartnerOrganizationId } : {}),
    ...(ballInCourtOrganizationId !== undefined ? { ballInCourtOrganizationId } : {}),
    ...(reviewDecisionCode !== undefined ? { reviewDecisionCode } : {}),
    ...(reviewRemarks !== undefined ? { reviewRemarks } : {}),
    ...(dueDate !== undefined ? { dueDate } : {}),
    version: optionalString(row.version) ?? '1',
    createdAt: optionalString(row.created_at) ?? '',
    updatedAt: optionalString(row.updated_at) ?? '',
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
  ): Promise<readonly ProjectDocument[]> {
    const query = new URLSearchParams({
      search,
      include_archived: String(includeArchived),
    });
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

  async listIssues(
    projectId: string,
    filters?: {
      status?: string;
      severity?: string;
      locationNodeId?: string;
      workNodeId?: string;
      contractorOrganizationId?: string;
    },
  ): Promise<readonly FieldIssue[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.severity) params.set('severity', filters.severity);
    if (filters?.locationNodeId) params.set('location_node_id', filters.locationNodeId);
    if (filters?.workNodeId) params.set('work_node_id', filters.workNodeId);
    if (filters?.contractorOrganizationId)
      params.set('contractor_organization_id', filters.contractorOrganizationId);

    const query = params.toString();
    const path = `projects/${encodeURIComponent(projectId)}/issues${query ? `?${query}` : ''}`;
    const response = asRecord(await this.request<unknown>(path));
    return pageItems(response).map(toFieldIssue);
  }

  async quickCreateIssue(
    projectId: string,
    input: {
      title: string;
      description: string;
      severity?: string;
      location_node_id?: string;
      work_node_id?: string;
      contractor_organization_id?: string;
      gps_lat?: number;
      gps_lng?: number;
      gps_accuracy_meters?: number;
      photo_file_ids?: readonly string[];
    },
  ): Promise<FieldIssue> {
    const response = asRecord(
      await this.request<unknown>(`projects/${encodeURIComponent(projectId)}/issues`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify(input),
      }),
    );
    return toFieldIssue(response);
  }

  async transitionIssue(
    projectId: string,
    issueId: string,
    status: string,
    comment?: string,
  ): Promise<FieldIssue> {
    const response = asRecord(
      await this.request<unknown>(
        `projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/transition`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': createIdempotencyKey(),
          },
          body: JSON.stringify({ status, ...(comment ? { comment } : {}) }),
        },
      ),
    );
    return toFieldIssue(response);
  }

  async escalateIssueToRfi(
    projectId: string,
    issueId: string,
    input: {
      title?: string;
      question?: string;
      priority?: string;
      due_date?: string;
      lead_contractor_partner_organization_id?: string;
      consultant_partner_organization_id?: string;
    },
  ): Promise<RfiRequest> {
    const response = asRecord(
      await this.request<unknown>(
        `projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/escalate-rfi`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': createIdempotencyKey(),
          },
          body: JSON.stringify(input),
        },
      ),
    );
    return toRfiRequest(response);
  }

  async listRfis(projectId: string): Promise<readonly RfiRequest[]> {
    const response = asRecord(
      await this.request<unknown>(`projects/${encodeURIComponent(projectId)}/rfis`),
    );
    return pageItems(response).map(toRfiRequest);
  }

  async createRfi(
    projectId: string,
    input: {
      title: string;
      question: string;
      priority?: string;
      due_date?: string;
      lead_contractor_partner_organization_id?: string;
      consultant_partner_organization_id?: string;
      location_node_id?: string;
      work_node_id?: string;
      cost_impact?: boolean;
      schedule_impact?: boolean;
    },
  ): Promise<RfiRequest> {
    const response = asRecord(
      await this.request<unknown>(`projects/${encodeURIComponent(projectId)}/rfis`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify(input),
      }),
    );
    return toRfiRequest(response);
  }

  async transitionRfi(
    projectId: string,
    rfiId: string,
    action: string,
    ballInCourtOrganizationId?: string,
  ): Promise<RfiRequest> {
    const response = asRecord(
      await this.request<unknown>(
        `projects/${encodeURIComponent(projectId)}/rfis/${encodeURIComponent(rfiId)}/transition`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': createIdempotencyKey(),
          },
          body: JSON.stringify({
            action,
            ...(ballInCourtOrganizationId
              ? { ball_in_court_organization_id: ballInCourtOrganizationId }
              : {}),
          }),
        },
      ),
    );
    return toRfiRequest(response);
  }

  async addRfiResponse(
    projectId: string,
    rfiId: string,
    input: {
      response_text: string;
      is_official?: boolean;
      cost_impact?: boolean;
      schedule_impact?: boolean;
    },
  ): Promise<unknown> {
    return this.request<unknown>(
      `projects/${encodeURIComponent(projectId)}/rfis/${encodeURIComponent(rfiId)}/responses`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify(input),
      },
    );
  }

  async listSubmittals(projectId: string): Promise<readonly Submittal[]> {
    const response = asRecord(
      await this.request<unknown>(`projects/${encodeURIComponent(projectId)}/submittals`),
    );
    return pageItems(response).map(toSubmittal);
  }

  async createSubmittal(
    projectId: string,
    input: {
      title: string;
      submittal_type: string;
      maker_partner_organization_id: string;
      description?: string;
      lead_contractor_partner_organization_id?: string;
      consultant_partner_organization_id?: string;
      due_date?: string;
      items?: Array<{
        item_number: number;
        description: string;
        material_trade_name?: string;
        manufacturer_name?: string;
        model_or_grade?: string;
      }>;
    },
  ): Promise<Submittal> {
    const response = asRecord(
      await this.request<unknown>(`projects/${encodeURIComponent(projectId)}/submittals`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify(input),
      }),
    );
    return toSubmittal(response);
  }

  async transitionSubmittal(
    projectId: string,
    submittalId: string,
    status: string,
    notes?: string,
  ): Promise<Submittal> {
    const response = asRecord(
      await this.request<unknown>(
        `projects/${encodeURIComponent(projectId)}/submittals/${encodeURIComponent(submittalId)}/transition`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': createIdempotencyKey(),
          },
          body: JSON.stringify({ status, ...(notes ? { notes } : {}) }),
        },
      ),
    );
    return toSubmittal(response);
  }

  async reviewSubmittal(
    projectId: string,
    submittalId: string,
    input: {
      decision_code: 'A' | 'B' | 'C' | 'D';
      review_comments: string;
      notes?: string;
    },
  ): Promise<unknown> {
    return this.request<unknown>(
      `projects/${encodeURIComponent(projectId)}/submittals/${encodeURIComponent(submittalId)}/reviews`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(),
        },
        body: JSON.stringify(input),
      },
    );
  }

  // Quality & Inspections
  async listInspections(projectId: string): Promise<readonly Inspection[]> {
    const res = await this.request<{ items: readonly Inspection[] }>(
      `projects/${encodeURIComponent(projectId)}/inspections`,
    );
    return res.items ?? [];
  }

  async createInspection(projectId: string, input: Record<string, unknown>): Promise<Inspection> {
    return this.request<Inspection>(`projects/${encodeURIComponent(projectId)}/inspections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': createIdempotencyKey() },
      body: JSON.stringify(input),
    });
  }

  async submitChecklistResults(
    inspectionId: string,
    results: readonly Record<string, unknown>[],
  ): Promise<unknown> {
    return this.request<unknown>(`inspections/${encodeURIComponent(inspectionId)}/results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': createIdempotencyKey() },
      body: JSON.stringify({ results }),
    });
  }

  // Acceptance Records
  async listAcceptanceRecords(projectId: string): Promise<readonly AcceptanceRecord[]> {
    const res = await this.request<{ items: readonly AcceptanceRecord[] }>(
      `projects/${encodeURIComponent(projectId)}/acceptance-records`,
    );
    return res.items ?? [];
  }

  async createAcceptanceRecord(
    projectId: string,
    input: Record<string, unknown>,
  ): Promise<AcceptanceRecord> {
    return this.request<AcceptanceRecord>(
      `projects/${encodeURIComponent(projectId)}/acceptance-records`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': createIdempotencyKey() },
        body: JSON.stringify(input),
      },
    );
  }

  async signAcceptance(
    recordId: string,
    role: 'contractor' | 'supervisor' | 'pmu',
    signatureData: string,
  ): Promise<AcceptanceRecord> {
    return this.request<AcceptanceRecord>(
      `acceptance-records/${encodeURIComponent(recordId)}/sign/${encodeURIComponent(role)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': createIdempotencyKey() },
        body: JSON.stringify({ signature_data: signatureData }),
      },
    );
  }

  // Daily Logs
  async listDailyLogs(projectId: string): Promise<readonly DailyLog[]> {
    const res = await this.request<{ items: readonly DailyLog[] }>(
      `projects/${encodeURIComponent(projectId)}/daily-logs`,
    );
    return res.items ?? [];
  }

  async createDailyLog(projectId: string, input: Record<string, unknown>): Promise<DailyLog> {
    return this.request<DailyLog>(`projects/${encodeURIComponent(projectId)}/daily-logs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': createIdempotencyKey() },
      body: JSON.stringify(input),
    });
  }

  async updateDailyLog(logId: string, input: Record<string, unknown>): Promise<DailyLog> {
    return this.request<DailyLog>(`daily-logs/${encodeURIComponent(logId)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async saveDailyManpower(logId: string, items: readonly unknown[]): Promise<DailyLog> {
    return this.request<DailyLog>(`daily-logs/${encodeURIComponent(logId)}/manpower`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  }

  async saveDailyEquipment(logId: string, items: readonly unknown[]): Promise<DailyLog> {
    return this.request<DailyLog>(`daily-logs/${encodeURIComponent(logId)}/equipment`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
  }

  async crawlDailyWeather(logId: string, gps?: { lat: number; lng: number }): Promise<DailyLog> {
    return this.request<DailyLog>(`daily-logs/${encodeURIComponent(logId)}/weather/crawl`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(gps ?? {}),
    });
  }

  async signDailyLogSiteManager(logId: string, signatureData: string): Promise<DailyLog> {
    return this.request<DailyLog>(`daily-logs/${encodeURIComponent(logId)}/sign/site-manager`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signature_data: signatureData }),
    });
  }

  async signDailyLogSupervisor(logId: string, signatureData: string): Promise<DailyLog> {
    return this.request<DailyLog>(`daily-logs/${encodeURIComponent(logId)}/sign/supervisor`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signature_data: signatureData }),
    });
  }

  // Offline Sync
  async syncOfflineBatch(projectId: string, input: Record<string, unknown>): Promise<unknown> {
    return this.request<unknown>(`projects/${encodeURIComponent(projectId)}/offline-sync/batches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async getOfflineChanges(projectId: string, cursor?: string): Promise<unknown> {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request<unknown>(
      `projects/${encodeURIComponent(projectId)}/offline-sync/changes${q}`,
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
