import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import {
  assertAnnotation,
  assertDeclaredFilePolicy,
  assertPublishAllowed,
  assertReviewerMayDecide,
  assertSafeFilename,
  assertWithdrawAllowed,
  DomainError,
  evaluateReviewRoute,
  normalizeContextKey,
  normalizeDocumentCode,
  parseExpectedVersion,
  revisionTransitionTarget,
  buildDrawingQrPayload,
  generateTransmittalSignature,
  type FileStatus,
  type ReviewAssignmentSnapshot,
  type ReviewDecision,
  type RevisionAction,
  type RevisionStatus,
} from '@vinops/domain';
import { S3ObjectStorage, type CompletedPart, type ObjectStorage } from '@vinops/file';
import { API_CONFIG, type ApiRuntimeConfig } from './api-runtime.js';
import { PlatformError } from './platform-error.js';
import type { RequestIdentity } from './platform.service.js';

type JsonRecord = Record<string, unknown>;
type IdempotencyRow = { id: string; payload_hash: string; status: string; response_body: unknown };
type ProjectPolicyRow = {
  project_id: string;
  organization_id: string;
  allowed_distribution_contexts: string[];
  allowed_media_types: string[];
  maximum_file_bytes: string;
  signed_url_ttl_seconds: number;
  default_review_mode: 'sequential' | 'quorum';
  default_reject_threshold: number;
};
type DocumentRow = {
  id: string;
  organization_id: string;
  project_id: string;
  numbering_context: string;
  code: string;
  title: string;
  document_type: string;
  discipline_id: string | null;
  classification_id: string | null;
  work_id: string | null;
  location_id: string | null;
  confidentiality: string;
  created_by: string;
  version: string;
  archived_at: Date | null;
};
type RevisionRow = {
  id: string;
  organization_id: string;
  project_id: string;
  document_id: string;
  revision_code: string;
  purpose: string;
  suitability_code: string | null;
  status: RevisionStatus;
  created_by: string;
  version: string;
  created_at: Date;
  published_at: Date | null;
  superseded_at: Date | null;
  archived_at: Date | null;
  file_id: string;
  file_status: FileStatus;
  original_filename: string;
  size_bytes: string;
  media_type: string;
  sha256: string;
  failure_code: string | null;
};
type UploadSessionRow = {
  id: string;
  organization_id: string;
  project_id: string;
  file_id: string;
  document_id: string;
  storage_upload_id: string;
  status: string;
  expires_at: Date;
  declared_size_bytes: string;
  declared_sha256: string;
  quarantine_object_key: string;
  file_status: FileStatus;
};
type PublishResult = {
  revision_id: string;
  revision_version: string;
  current_version: string;
  superseded_revision_id: string | null;
};

export type CreateDocumentInput = {
  code: string;
  title: string;
  documentType: string;
  numberingContext?: string | undefined;
  disciplineId?: string | undefined;
  classificationId?: string | undefined;
  workId?: string | undefined;
  locationId?: string | undefined;
  confidentiality?: 'internal' | 'restricted' | 'project' | undefined;
};

export type CreateRevisionInput = {
  revisionCode: string;
  purpose: string;
  suitabilityCode?: string | undefined;
  filename: string;
  sizeBytes: number;
  mediaType: string;
  sha256: string;
};

export type RevisionTransitionInput = {
  action: RevisionAction;
  expectedVersion: string;
  expectedCurrentVersion?: string | undefined;
  contextKey?: string | undefined;
  reason?: string | undefined;
  reviewerIds?: readonly string[] | undefined;
  reviewMode?: 'sequential' | 'quorum' | undefined;
  requiredApprovals?: number | undefined;
  rejectThreshold?: number | undefined;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as JsonRecord;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function record(value: unknown): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformError('IDEMPOTENCY_RESPONSE_INVALID', 'errors.internal', 500, false);
  }
  return value as JsonRecord;
}

function databaseFailure(error: unknown): never {
  if (error instanceof DomainError) {
    const forbidden = ['MAKER_CHECKER_VIOLATION', 'REVIEWER_NOT_ACTIONABLE'].includes(error.code);
    const conflict = [
      'INVALID_REVISION_TRANSITION',
      'REVIEW_DECISION_IMMUTABLE',
      'CURRENT_REVISION_WITHDRAW_FORBIDDEN',
      'MANDATORY_COMMENT_DISPOSITION_REQUIRED',
    ].includes(error.code);
    throw new PlatformError(
      error.code,
      forbidden ? 'errors.permissionDenied' : conflict ? 'errors.conflict' : 'errors.validation',
      forbidden ? 403 : conflict ? 409 : 422,
      error.retryable,
    );
  }
  if (error !== null && typeof error === 'object') {
    const candidate = error as { code?: string; message?: string };
    const message = candidate.message ?? '';
    const named = [
      'REVISION_VERSION_CONFLICT',
      'CURRENT_VERSION_CONFLICT',
      'REVISION_NOT_APPROVED',
      'REVIEW_ROUTE_INCOMPLETE',
      'MANDATORY_COMMENT_DISPOSITION_REQUIRED',
      'FILE_NOT_AVAILABLE',
      'MAKER_CHECKER_VIOLATION',
      'APPEND_ONLY_HISTORY',
      'TRANSMITTAL_SNAPSHOT_IMMUTABLE',
    ].find((code) => message.includes(code));
    if (named !== undefined) {
      const denied = named === 'MAKER_CHECKER_VIOLATION';
      throw new PlatformError(
        named,
        denied ? 'errors.permissionDenied' : 'errors.conflict',
        denied ? 403 : 409,
        candidate.code === '40001',
      );
    }
    if (candidate.code === '23505') {
      throw new PlatformError('CONFLICT', 'errors.conflict', 409, false);
    }
    if (candidate.code === '42501') {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
    if (candidate.code === '23514' || candidate.code === '22P02' || candidate.code === '23503') {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
  }
  throw error;
}

@Injectable()
export class DocumentService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;
  private readonly storage: ObjectStorage | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-document-api',
            runtimeRole: 'vinops_app',
          });
    this.storage =
      config.VINOPS_S3_ENDPOINT === undefined ||
      config.VINOPS_S3_BUCKET === undefined ||
      config.VINOPS_S3_ACCESS_KEY_ID === undefined ||
      config.VINOPS_S3_SECRET_ACCESS_KEY === undefined
        ? undefined
        : new S3ObjectStorage({
            endpoint: config.VINOPS_S3_ENDPOINT,
            region: config.VINOPS_S3_REGION,
            bucket: config.VINOPS_S3_BUCKET,
            accessKeyId: config.VINOPS_S3_ACCESS_KEY_ID,
            secretAccessKey: config.VINOPS_S3_SECRET_ACCESS_KEY,
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  async listDocuments(
    identity: RequestIdentity,
    projectId: string,
    search: string | undefined,
    includeArchived: boolean,
    correlationId: string,
    filters?: {
      locationId?: string | undefined;
      disciplineId?: string | undefined;
      workId?: string | undefined;
      documentType?: string | undefined;
    },
  ): Promise<readonly JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      await this.requireProjectMember(transaction, projectId, identity.userId);
      const normalizedSearch = search?.trim().slice(0, 120) ?? '';
      const rows = await transaction.query<DocumentRow>(
        `SELECT document.id, document.organization_id, document.project_id, document.numbering_context,
                document.code, document.title, document.document_type, document.discipline_id,
                document.classification_id, document.work_id, document.location_id, document.confidentiality,
                document.created_by, document.version::text, document.archived_at
           FROM vinops.documents document
          WHERE document.project_id = $1::uuid
            AND ($2::boolean OR document.archived_at IS NULL)
            AND ($3 = '' OR document.code ILIKE '%' || $3 || '%' OR document.title ILIKE '%' || $3 || '%')
            AND ($4::uuid IS NULL OR document.location_id = $4::uuid)
            AND ($5::uuid IS NULL OR document.discipline_id = $5::uuid)
            AND ($6::uuid IS NULL OR document.work_id = $6::uuid)
            AND ($7::text IS NULL OR document.document_type = $7::text)
          ORDER BY document.code, document.id LIMIT 200`,
        [
          projectId,
          includeArchived,
          normalizedSearch,
          filters?.locationId ?? null,
          filters?.disciplineId ?? null,
          filters?.workId ?? null,
          filters?.documentType ?? null,
        ],
      );
      const result: JsonRecord[] = [];
      for (const document of rows) {
        const current = await this.currentRevision(transaction, document.id, 'default');
        result.push(this.documentOutput(document, current));
      }
      return result;
    });
  }

  async createDocument(
    identity: RequestIdentity,
    projectId: string,
    input: CreateDocumentInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    const code = normalizeDocumentCode(input.code);
    const numberingContext = normalizeContextKey(input.numberingContext);
    if (input.title.trim().length < 1 || input.title.trim().length > 300) {
      throw new PlatformError('DOCUMENT_TITLE_INVALID', 'errors.validation', 422, false);
    }
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      const policy = await this.policy(transaction, projectId);
      await this.requireCreateDocumentAction(transaction, projectId, identity.userId, input);
      return this.idempotent(
        transaction,
        identity.userId,
        'document.create',
        idempotencyKey,
        { projectId, input: { ...input, code, numberingContext } },
        async () => {
          if (
            !policy.allowed_distribution_contexts.includes(numberingContext) &&
            numberingContext !== 'default'
          ) {
            throw new PlatformError(
              'NUMBERING_CONTEXT_NOT_CONFIGURED',
              'errors.validation',
              422,
              false,
            );
          }
          const id = randomUUID();
          const rows = await transaction.query<DocumentRow>(
            `INSERT INTO vinops.documents (
              id, organization_id, project_id, numbering_context, code, title, document_type,
              discipline_id, classification_id, work_id, location_id, confidentiality, created_by
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
              $8::uuid, $9::uuid, $10::uuid, $11::uuid, $12, $13::uuid
            ) RETURNING id, organization_id, project_id, numbering_context, code, title,
              document_type, discipline_id, classification_id, work_id, location_id, confidentiality,
              created_by, version::text, archived_at`,
            [
              id,
              policy.organization_id,
              projectId,
              numberingContext,
              code,
              input.title.trim(),
              input.documentType.trim(),
              input.disciplineId ?? null,
              input.classificationId ?? null,
              input.workId ?? null,
              input.locationId ?? null,
              input.confidentiality ?? 'project',
              identity.userId,
            ],
          );
          const document = this.one(rows);
          await this.audit(transaction, {
            identity,
            organizationId: policy.organization_id,
            projectId,
            action: 'document.create',
            entityType: 'document',
            entityId: document.id,
            entityVersion: document.version,
            correlationId,
          });
          await this.outbox(transaction, {
            organizationId: policy.organization_id,
            projectId,
            aggregateType: 'document',
            aggregateId: document.id,
            eventType: 'document.created.v1',
            payload: { document_id: document.id },
          });
          return this.documentOutput(document, null);
        },
      );
    });
  }

  async documentDetail(
    identity: RequestIdentity,
    documentId: string,
    exactRevisionId: string | undefined,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const document = await this.document(transaction, documentId);
      const revisions = await this.revisions(transaction, document.id);
      const current = await this.currentRevision(transaction, document.id, 'default');
      const currentPointer = await transaction.query<{ version: string }>(
        `SELECT version::text FROM vinops.document_current_revisions
          WHERE document_id = $1::uuid AND context_key = 'default'`,
        [document.id],
      );
      const exact =
        exactRevisionId === undefined
          ? null
          : (revisions.find((item) => item.id === exactRevisionId) ?? null);
      if (exactRevisionId !== undefined && exact === null) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404, false);
      }
      const comments = await transaction.query<JsonRecord>(
        `SELECT comment.id, comment.revision_id, comment.author_user_id, comment.importance,
                comment.body, comment.page, comment.x::float8, comment.y::float8,
                comment.created_at, disposition.id AS disposition_id,
                disposition.disposition, disposition.response, disposition.created_by AS disposition_created_by,
                disposition.created_at AS disposition_created_at
           FROM vinops.review_comments comment
           LEFT JOIN vinops.review_comment_dispositions disposition ON disposition.comment_id = comment.id
          WHERE comment.revision_id = ANY($1::uuid[])
          ORDER BY comment.created_at, comment.id`,
        [revisions.map((revision) => revision.id)],
      );
      const annotations = await transaction.query<JsonRecord>(
        `SELECT id, revision_id, page, x::float8, y::float8, kind, body,
                linked_entity_type, linked_entity_id, created_by, created_at
           FROM vinops.annotations WHERE revision_id = ANY($1::uuid[])
          ORDER BY revision_id, page, created_at, id`,
        [revisions.map((revision) => revision.id)],
      );
      const decisions = await transaction.query<JsonRecord>(
        `SELECT decision.id, decision.revision_id, decision.assignment_id,
                decision.reviewer_id, decision.decision, decision.reason,
                decision.effective_roles, decision.decided_at
           FROM vinops.review_decisions decision
          WHERE decision.revision_id = ANY($1::uuid[])
          ORDER BY decision.decided_at, decision.id`,
        [revisions.map((revision) => revision.id)],
      );
      return {
        ...this.documentOutput(document, current),
        revision_count: revisions.length,
        revisions: revisions.map((revision) => this.revisionOutput(revision)),
        exact_revision: exact === null ? null : this.revisionOutput(exact),
        superseded_banner: exact?.status === 'Superseded',
        current_link_authorized: exact?.status === 'Superseded' && current !== null,
        current_pointer_version: currentPointer[0]?.version ?? '0',
        review_comments: comments,
        annotations,
        review_decisions: decisions,
        allowed_actions: await this.allowedDocumentActions(transaction, document, identity.userId),
      };
    });
  }

  async createRevision(
    identity: RequestIdentity,
    documentId: string,
    input: CreateRevisionInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    const storage = this.requireStorage();
    assertSafeFilename(input.filename);
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      const document = await this.document(transaction, documentId);
      const policy = await this.policy(transaction, document.project_id);
      await this.requireDocumentAction(
        transaction,
        document.id,
        document.project_id,
        identity.userId,
        'revision.create',
      );
      assertDeclaredFilePolicy(
        {
          maximumBytes: Number(policy.maximum_file_bytes),
          allowedMediaTypes: policy.allowed_media_types,
        },
        input,
      );
      return this.idempotent(
        transaction,
        identity.userId,
        'revision.create',
        idempotencyKey,
        { documentId, input },
        async () => {
          const revisionId = randomUUID();
          const fileId = randomUUID();
          const fileVersionId = randomUUID();
          const uploadSessionId = randomUUID();
          const objectKey = `quarantine/${fileId}/original`;
          const storageUploadId = await storage.createMultipartUpload(objectKey, input.mediaType);
          await transaction.execute(
            `INSERT INTO vinops.file_objects (
              id, organization_id, project_id, storage_provider, storage_bucket,
              quarantine_object_key, original_filename, declared_size_bytes,
              declared_media_type, declared_sha256, status, created_by
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, 's3', $4, $5, $6, $7::bigint, $8, $9, 'Uploading', $10::uuid)`,
            [
              fileId,
              document.organization_id,
              document.project_id,
              this.config.VINOPS_S3_BUCKET,
              objectKey,
              input.filename,
              input.sizeBytes,
              input.mediaType.toLowerCase(),
              input.sha256,
              identity.userId,
            ],
          );
          const revisions = await transaction.query<RevisionRow>(
            `INSERT INTO vinops.document_revisions (
              id, organization_id, project_id, document_id, revision_code, purpose,
              suitability_code, created_by
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid)
            RETURNING id, organization_id, project_id, document_id, revision_code, purpose,
              suitability_code, status, created_by, version::text, created_at, published_at,
              superseded_at, archived_at, $9::uuid AS file_id, 'Uploading'::text AS file_status,
              $10::text AS original_filename, $11::bigint::text AS size_bytes,
              $12::text AS media_type, $13::text AS sha256, NULL::text AS failure_code`,
            [
              revisionId,
              document.organization_id,
              document.project_id,
              document.id,
              input.revisionCode.trim(),
              input.purpose.trim(),
              input.suitabilityCode?.trim() ?? null,
              identity.userId,
              fileId,
              input.filename,
              input.sizeBytes,
              input.mediaType.toLowerCase(),
              input.sha256,
            ],
          );
          await transaction.execute(
            `INSERT INTO vinops.revision_file_versions (
              id, organization_id, project_id, revision_id, technical_version, file_id, created_by
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, $5::uuid, $6::uuid)`,
            [
              fileVersionId,
              document.organization_id,
              document.project_id,
              revisionId,
              fileId,
              identity.userId,
            ],
          );
          await transaction.execute(
            `INSERT INTO vinops.document_revision_current_files (revision_id, revision_file_version_id)
             VALUES ($1::uuid, $2::uuid)`,
            [revisionId, fileVersionId],
          );
          const expiresAt = new Date(Date.now() + 60 * 60 * 1_000);
          await transaction.execute(
            `INSERT INTO vinops.upload_sessions (
              id, organization_id, project_id, file_id, storage_upload_id,
              credential_hash, status, part_size_bytes, expires_at
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'Open', 5242880, $7::timestamptz)`,
            [
              uploadSessionId,
              document.organization_id,
              document.project_id,
              fileId,
              storageUploadId,
              hash(randomUUID()),
              expiresAt,
            ],
          );
          const revision = this.one(revisions);
          await this.audit(transaction, {
            identity,
            organizationId: document.organization_id,
            projectId: document.project_id,
            action: 'revision.create',
            entityType: 'document_revision',
            entityId: revision.id,
            entityVersion: revision.version,
            correlationId,
          });
          return {
            revision: this.revisionOutput(revision),
            upload_session: {
              id: uploadSessionId,
              expires_at: expiresAt.toISOString(),
              chunk_size_bytes: 5_242_880,
              upload_target: `/api/v1/upload-sessions/${uploadSessionId}/parts/{partNumber}/authorization`,
            },
            duplicate_signal: await this.duplicateSignal(
              transaction,
              document.project_id,
              input.sha256,
            ),
          };
        },
      );
    });
  }

  async authorizeUploadPart(
    identity: RequestIdentity,
    uploadSessionId: string,
    partNumber: number,
    correlationId: string,
  ): Promise<JsonRecord> {
    const storage = this.requireStorage();
    return this.transaction(identity, correlationId, async (transaction) => {
      const session = await this.uploadSession(transaction, uploadSessionId, true);
      await this.requireDocumentAction(
        transaction,
        session.document_id,
        session.project_id,
        identity.userId,
        'revision.create',
      );
      if (session.expires_at.getTime() <= Date.now()) {
        throw new PlatformError('UPLOAD_SESSION_EXPIRED', 'errors.validation', 422, false);
      }
      if (session.status !== 'Open' || session.file_status !== 'Uploading') {
        throw new PlatformError('UPLOAD_SESSION_NOT_OPEN', 'errors.conflict', 409, false);
      }
      const expiresSeconds = Math.min(this.config.VINOPS_SIGNED_URL_TTL_SECONDS, 300);
      const url = await storage.authorizeUploadPart(
        session.quarantine_object_key,
        session.storage_upload_id,
        partNumber,
        expiresSeconds,
      );
      await this.audit(transaction, {
        identity,
        organizationId: session.organization_id,
        projectId: session.project_id,
        action: 'upload.part.authorize',
        entityType: 'upload_session',
        entityId: session.id,
        correlationId,
      });
      return {
        url,
        expires_at: new Date(Date.now() + expiresSeconds * 1_000).toISOString(),
        part_number: partNumber,
      };
    });
  }

  async completeUpload(
    identity: RequestIdentity,
    uploadSessionId: string,
    parts: readonly CompletedPart[],
    sizeBytes: number,
    sha256: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    const storage = this.requireStorage();
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      const session = await this.uploadSession(transaction, uploadSessionId, true);
      await this.requireDocumentAction(
        transaction,
        session.document_id,
        session.project_id,
        identity.userId,
        'revision.create',
      );
      return this.idempotent(
        transaction,
        identity.userId,
        'upload.complete',
        idempotencyKey,
        { uploadSessionId, parts, sizeBytes, sha256 },
        async () => {
          if (session.expires_at.getTime() <= Date.now()) {
            await transaction.execute(
              `UPDATE vinops.upload_sessions SET status = 'Expired' WHERE id = $1::uuid`,
              [session.id],
            );
            throw new PlatformError('UPLOAD_SESSION_EXPIRED', 'errors.validation', 422, false);
          }
          if (session.status !== 'Open') {
            throw new PlatformError('UPLOAD_SESSION_NOT_OPEN', 'errors.conflict', 409, false);
          }
          if (
            String(sizeBytes) !== session.declared_size_bytes ||
            sha256 !== session.declared_sha256
          ) {
            await transaction.execute(
              `UPDATE vinops.file_objects SET status = 'Quarantined', failure_code = 'UPLOAD_DECLARATION_MISMATCH'
                WHERE id = $1::uuid`,
              [session.file_id],
            );
            await transaction.execute(
              `UPDATE vinops.upload_sessions SET status = 'Completed', completed_at = now() WHERE id = $1::uuid`,
              [session.id],
            );
            return {
              id: session.file_id,
              status: 'Quarantined',
              failure_code: 'UPLOAD_DECLARATION_MISMATCH',
            };
          }
          await storage.completeMultipartUpload(
            session.quarantine_object_key,
            session.storage_upload_id,
            parts,
          );
          const metadata = await storage.headObject(session.quarantine_object_key);
          if (metadata.sizeBytes !== sizeBytes) {
            await transaction.execute(
              `UPDATE vinops.file_objects SET status = 'Quarantined', failure_code = 'UPLOAD_INCOMPLETE', actual_size_bytes = $2
                WHERE id = $1::uuid`,
              [session.file_id, metadata.sizeBytes],
            );
            return {
              id: session.file_id,
              status: 'Quarantined',
              failure_code: 'UPLOAD_INCOMPLETE',
            };
          }
          await transaction.execute(
            `UPDATE vinops.upload_sessions SET status = 'Completed', received_bytes = $2, completed_at = now()
              WHERE id = $1::uuid`,
            [session.id, metadata.sizeBytes],
          );
          await transaction.execute(
            `UPDATE vinops.file_objects SET status = 'Validating' WHERE id = $1::uuid`,
            [session.file_id],
          );
          await transaction.execute(
            `INSERT INTO vinops.file_processing_jobs (
              id, organization_id, project_id, file_id, job_type
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'validate_scan_preview')
            ON CONFLICT (file_id, job_type) DO NOTHING`,
            [randomUUID(), session.organization_id, session.project_id, session.file_id],
          );
          await this.outbox(transaction, {
            organizationId: session.organization_id,
            projectId: session.project_id,
            aggregateType: 'file_object',
            aggregateId: session.file_id,
            eventType: 'file.validation.requested.v1',
            payload: { file_id: session.file_id },
          });
          await this.audit(transaction, {
            identity,
            organizationId: session.organization_id,
            projectId: session.project_id,
            action: 'upload.complete',
            entityType: 'file_object',
            entityId: session.file_id,
            correlationId,
          });
          return {
            id: session.file_id,
            status: 'Validating',
            size_bytes: sizeBytes,
            sha256,
          };
        },
      );
    });
  }

  async transitionRevision(
    identity: RequestIdentity,
    revisionId: string,
    input: RevisionTransitionInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    if (input.action === 'publish') {
      return this.publish(identity, revisionId, input, idempotencyKey, correlationId);
    }
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      const revision = await this.revision(transaction, revisionId, true);
      return this.idempotent(
        transaction,
        identity.userId,
        `revision.${input.action}`,
        idempotencyKey,
        { revisionId, input },
        async () => {
          const expectedVersion = parseExpectedVersion(input.expectedVersion);
          if (BigInt(revision.version) !== expectedVersion) {
            throw new PlatformError('REVISION_VERSION_CONFLICT', 'errors.conflict', 409, true);
          }
          if (input.action === 'submit_review') {
            await this.requireDocumentAction(
              transaction,
              revision.document_id,
              revision.project_id,
              identity.userId,
              'revision.submit',
            );
            return this.submitReview(transaction, identity, revision, input, correlationId);
          }
          if (
            input.action === 'approve' ||
            input.action === 'approve_with_comments' ||
            input.action === 'reject'
          ) {
            return this.decideReview(transaction, identity, revision, input, correlationId);
          }
          if (input.action === 'withdraw') {
            await this.requireDocumentAction(
              transaction,
              revision.document_id,
              revision.project_id,
              identity.userId,
              'revision.withdraw',
            );
            const current = await transaction.query<{ exists: boolean }>(
              `SELECT EXISTS (SELECT 1 FROM vinops.document_current_revisions WHERE revision_id = $1::uuid) AS exists`,
              [revision.id],
            );
            assertWithdrawAllowed({
              status: revision.status,
              isCurrent: current[0]?.exists === true,
              reason: input.reason,
            });
            return this.changeRevisionState(
              transaction,
              identity,
              revision,
              'withdraw',
              'Withdrawn',
              input.reason,
              correlationId,
            );
          }
          throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
        },
      );
    });
  }

  async addReviewComment(
    identity: RequestIdentity,
    revisionId: string,
    input: {
      importance: 'mandatory' | 'advisory';
      body: string;
      page?: number | undefined;
      x?: number | undefined;
      y?: number | undefined;
    },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      const revision = await this.revision(transaction, revisionId, false);
      return this.idempotent(
        transaction,
        identity.userId,
        'review.comment.create',
        idempotencyKey,
        { revisionId, input },
        async () => {
          if (revision.status !== 'Under Review') {
            throw new PlatformError('INVALID_REVISION_TRANSITION', 'errors.conflict', 409, false);
          }
          await this.requireAssignedReviewer(transaction, revision.id, identity.userId);
          if (input.page !== undefined || input.x !== undefined || input.y !== undefined) {
            assertAnnotation({
              page: input.page ?? 1,
              x: input.x ?? 0,
              y: input.y ?? 0,
              kind: 'note',
              body: input.body,
            });
          }
          const id = randomUUID();
          const rows = await transaction.query<JsonRecord>(
            `INSERT INTO vinops.review_comments (
              id, organization_id, project_id, revision_id, author_user_id,
              importance, body, page, x, y
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8, $9, $10)
            RETURNING id, revision_id, author_user_id, importance, body, page, x::float8, y::float8, created_at`,
            [
              id,
              revision.organization_id,
              revision.project_id,
              revision.id,
              identity.userId,
              input.importance,
              input.body.trim(),
              input.page ?? null,
              input.x ?? null,
              input.y ?? null,
            ],
          );
          await this.audit(transaction, {
            identity,
            organizationId: revision.organization_id,
            projectId: revision.project_id,
            action: 'review.comment.create',
            entityType: 'review_comment',
            entityId: id,
            correlationId,
          });
          return this.one(rows);
        },
      );
    });
  }

  async disposeReviewComment(
    identity: RequestIdentity,
    commentId: string,
    input: { disposition: string; response: string },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.auditedIdempotent(identity, correlationId, async (transaction) =>
      this.idempotent(
        transaction,
        identity.userId,
        'review.comment.disposition',
        idempotencyKey,
        { commentId, input },
        async () => {
          const comments = await transaction.query<{
            id: string;
            organization_id: string;
            project_id: string;
            revision_id: string;
            document_id: string;
            revision_status: RevisionStatus;
          }>(
            `SELECT comment.id, comment.organization_id, comment.project_id, comment.revision_id,
                    revision.document_id,
                    revision.status AS revision_status
               FROM vinops.review_comments comment
               JOIN vinops.document_revisions revision ON revision.id = comment.revision_id
              WHERE comment.id = $1::uuid`,
            [commentId],
          );
          const comment = this.one(comments);
          await this.requireDocumentAction(
            transaction,
            comment.document_id,
            comment.project_id,
            identity.userId,
            'comment.dispose',
          );
          if (!['Under Review', 'Approved with Comments'].includes(comment.revision_status)) {
            throw new PlatformError('INVALID_REVISION_TRANSITION', 'errors.conflict', 409, false);
          }
          const id = randomUUID();
          const rows = await transaction.query<JsonRecord>(
            `INSERT INTO vinops.review_comment_dispositions (
              id, organization_id, project_id, revision_id, comment_id,
              disposition, response, created_by
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::uuid)
            RETURNING id, comment_id, disposition, response, created_by, created_at`,
            [
              id,
              comment.organization_id,
              comment.project_id,
              comment.revision_id,
              comment.id,
              input.disposition,
              input.response.trim(),
              identity.userId,
            ],
          );
          return this.one(rows);
        },
      ),
    );
  }

  async addAnnotation(
    identity: RequestIdentity,
    revisionId: string,
    input: {
      page: number;
      x: number;
      y: number;
      kind: string;
      body?: string | undefined;
      linkedEntityType?: string | undefined;
      linkedEntityId?: string | undefined;
    },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    assertAnnotation(input);
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      const revision = await this.revision(transaction, revisionId, false);
      await this.requireDocumentAction(
        transaction,
        revision.document_id,
        revision.project_id,
        identity.userId,
        'annotation.create',
      );
      return this.idempotent(
        transaction,
        identity.userId,
        'annotation.create',
        idempotencyKey,
        { revisionId, input },
        async () => {
          const id = randomUUID();
          const rows = await transaction.query<JsonRecord>(
            `INSERT INTO vinops.annotations (
              id, organization_id, project_id, revision_id, page, x, y, kind,
              body, linked_entity_type, linked_entity_id, created_by
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10, $11::uuid, $12::uuid)
            RETURNING id, revision_id, page, x::float8, y::float8, kind, body,
              linked_entity_type, linked_entity_id, created_by, created_at`,
            [
              id,
              revision.organization_id,
              revision.project_id,
              revision.id,
              input.page,
              input.x,
              input.y,
              input.kind,
              input.body ?? null,
              input.linkedEntityType ?? null,
              input.linkedEntityId ?? null,
              identity.userId,
            ],
          );
          return this.one(rows);
        },
      );
    });
  }

  async authorizeFileAccess(
    identity: RequestIdentity,
    revisionId: string,
    kind: 'preview' | 'download',
    correlationId: string,
  ): Promise<JsonRecord> {
    const storage = this.requireStorage();
    return this.transaction(identity, correlationId, async (transaction) => {
      const revision = await this.revision(transaction, revisionId, false);
      if (revision.file_status !== 'Available') {
        await this.audit(transaction, {
          identity,
          organizationId: revision.organization_id,
          projectId: revision.project_id,
          action: `file.${kind}`,
          entityType: 'file_object',
          entityId: revision.file_id,
          correlationId,
          outcome: 'denied',
        });
        throw new PlatformError('FILE_NOT_AVAILABLE', 'errors.conflict', 409, false);
      }
      const objects = await transaction.query<{ key: string; ttl: number }>(
        kind === 'preview'
          ? `SELECT derivative.storage_object_key AS key, policy.signed_url_ttl_seconds AS ttl
               FROM vinops.file_derivatives derivative
               JOIN vinops.project_document_policies policy ON policy.project_id = derivative.project_id
              WHERE derivative.file_id = $1::uuid AND derivative.kind = 'preview'`
          : `SELECT file.available_object_key AS key, policy.signed_url_ttl_seconds AS ttl
               FROM vinops.file_objects file
               JOIN vinops.project_document_policies policy ON policy.project_id = file.project_id
              WHERE file.id = $1::uuid`,
        [revision.file_id],
      );
      const object = this.one(objects);
      const expiresAt = new Date(Date.now() + object.ttl * 1_000);
      const url = await storage.authorizeGet(
        object.key,
        object.ttl,
        kind === 'download' ? revision.original_filename : undefined,
      );
      await transaction.execute(
        `INSERT INTO vinops.file_access_events (
          id, organization_id, project_id, file_id, revision_id, actor_user_id,
          access_kind, outcome, expires_at, correlation_id
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, 'success', $8, $9::uuid)`,
        [
          randomUUID(),
          revision.organization_id,
          revision.project_id,
          revision.file_id,
          revision.id,
          identity.userId,
          kind,
          expiresAt,
          correlationId,
        ],
      );
      return { url, expires_at: expiresAt.toISOString(), filename: revision.original_filename };
    });
  }

  async reviewInbox(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<readonly JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      await this.requireProjectMember(transaction, projectId, identity.userId);
      return transaction.query<JsonRecord>(
        `SELECT assignment.id AS assignment_id, revision.id AS revision_id, revision.revision_code,
                revision.status, revision.version::text, document.id AS document_id, document.code AS document_code,
                document.title, assignment.sequence, assignment.due_at,
                decision.decision, decision.decided_at
           FROM vinops.review_assignments assignment
           JOIN vinops.revision_review_routes route ON route.id = assignment.route_id
           JOIN vinops.document_revisions revision ON revision.id = route.revision_id
           JOIN vinops.documents document ON document.id = revision.document_id
           LEFT JOIN vinops.review_decisions decision ON decision.assignment_id = assignment.id
          WHERE assignment.project_id = $1::uuid AND assignment.reviewer_id = $2::uuid
          ORDER BY assignment.due_at NULLS LAST, document.code, revision.revision_code`,
        [projectId, identity.userId],
      );
    });
  }

  async createTransmittal(
    identity: RequestIdentity,
    projectId: string,
    input: {
      code: string;
      purpose: string;
      items: readonly { revisionId: string; contextKey?: string | undefined }[];
      recipients: readonly {
        type: 'user' | 'organization' | 'external';
        reference: string;
        name: string;
        address?: string | undefined;
      }[];
    },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      await this.requireAction(transaction, projectId, identity.userId, 'transmittal.create');
      const policy = await this.policy(transaction, projectId);
      return this.idempotent(
        transaction,
        identity.userId,
        'transmittal.create',
        idempotencyKey,
        { projectId, input },
        async () => {
          if (input.items.length === 0 || input.recipients.length === 0) {
            throw new PlatformError('TRANSMITTAL_SNAPSHOT_EMPTY', 'errors.validation', 422, false);
          }
          const snapshots: JsonRecord[] = [];
          for (const item of input.items) {
            const revision = await this.revision(transaction, item.revisionId, false);
            if (
              revision.project_id !== projectId ||
              !['Published', 'Superseded'].includes(revision.status) ||
              revision.file_status !== 'Available'
            ) {
              throw new PlatformError('TRANSMITTAL_ITEM_INVALID', 'errors.validation', 422, false);
            }
            const document = await this.document(transaction, revision.document_id);
            snapshots.push({
              document_id: document.id,
              revision_id: revision.id,
              context_key: normalizeContextKey(item.contextKey),
              document_code: document.code,
              document_title: document.title,
              revision_code: revision.revision_code,
              file_sha256: revision.sha256,
            });
          }
          const id = randomUUID();
          const issuedAt = new Date();
          const snapshotSha256 = hash(
            stableJson({
              snapshots,
              recipients: input.recipients,
              issuedAt: issuedAt.toISOString(),
            }),
          );
          const signature = generateTransmittalSignature(snapshotSha256, policy.organization_id);
          for (const snapshot of snapshots) {
            const qrPayload = buildDrawingQrPayload({
              transmittalId: id,
              documentCode: snapshot.document_code as string,
              revisionCode: snapshot.revision_code as string,
              fileSha256: snapshot.file_sha256 as string,
              signature,
              issuedAt: issuedAt.toISOString(),
            });
            snapshot.signature = signature;
            snapshot.qr_payload = qrPayload;
            snapshot.verification_url = `/verify/drawings/${String(snapshot.document_id)}?transmittal=${id}&rev=${String(snapshot.revision_code)}&sig=${signature.slice(0, 16)}`;
          }
          await transaction.execute(
            `INSERT INTO vinops.transmittals (
              id, organization_id, project_id, code, purpose, status, created_by,
              issued_at, snapshot_sha256
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'Issued', $6::uuid, $7, $8)`,
            [
              id,
              policy.organization_id,
              projectId,
              input.code.trim(),
              input.purpose.trim(),
              identity.userId,
              issuedAt,
              snapshotSha256,
            ],
          );
          for (const snapshot of snapshots) {
            await transaction.execute(
              `INSERT INTO vinops.transmittal_items (
                id, organization_id, project_id, transmittal_id, document_id, revision_id,
                context_key, document_code_snapshot, document_title_snapshot,
                revision_code_snapshot, file_sha256_snapshot
              ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9, $10, $11)`,
              [
                randomUUID(),
                policy.organization_id,
                projectId,
                id,
                snapshot.document_id,
                snapshot.revision_id,
                snapshot.context_key,
                snapshot.document_code,
                snapshot.document_title,
                snapshot.revision_code,
                snapshot.file_sha256,
              ],
            );
          }
          for (const recipient of input.recipients) {
            await transaction.execute(
              `INSERT INTO vinops.transmittal_recipients (
                id, organization_id, project_id, transmittal_id, recipient_type,
                recipient_reference, recipient_name_snapshot, recipient_address_snapshot, sent_at
              ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9)`,
              [
                randomUUID(),
                policy.organization_id,
                projectId,
                id,
                recipient.type,
                recipient.reference.trim(),
                recipient.name.trim(),
                recipient.address?.trim() ?? null,
                issuedAt,
              ],
            );
          }
          await this.audit(transaction, {
            identity,
            organizationId: policy.organization_id,
            projectId,
            action: 'transmittal.issue',
            entityType: 'transmittal',
            entityId: id,
            correlationId,
          });
          return {
            id,
            project_id: projectId,
            code: input.code.trim(),
            purpose: input.purpose.trim(),
            status: 'Issued',
            issued_at: issuedAt.toISOString(),
            snapshot_sha256: snapshotSha256,
            signature,
            items: snapshots,
            recipients: input.recipients,
          };
        },
      );
    });
  }

  async transmittalDetail(
    identity: RequestIdentity,
    transmittalId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    try {
      return await this.transaction(identity, correlationId, async (transaction) => {
        const rows = await transaction.query<JsonRecord>(
          `SELECT id, project_id, code, purpose, status, created_by, created_at,
                  issued_at, snapshot_sha256, version::text
             FROM vinops.transmittals WHERE id = $1::uuid`,
          [transmittalId],
        );
        const transmittal = this.one(rows);
        const items = await transaction.query<JsonRecord>(
          `SELECT document_id, revision_id, context_key, document_code_snapshot,
                  document_title_snapshot, revision_code_snapshot, file_sha256_snapshot
             FROM vinops.transmittal_items WHERE transmittal_id = $1::uuid ORDER BY created_at, id`,
          [transmittalId],
        );
        const recipients = await transaction.query<JsonRecord>(
          `SELECT id, recipient_type, recipient_reference, recipient_name_snapshot,
                  recipient_address_snapshot, sent_at
             FROM vinops.transmittal_recipients WHERE transmittal_id = $1::uuid ORDER BY created_at, id`,
          [transmittalId],
        );
        return { ...transmittal, items, recipients };
      });
    } catch (error) {
      if (
        error !== null &&
        typeof error === 'object' &&
        (error as { code?: string }).code === '42P17'
      ) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404, false);
      }
      throw error;
    }
  }

  async setDocumentArchived(
    identity: RequestIdentity,
    documentId: string,
    archived: boolean,
    expectedVersion: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      const document = await this.document(transaction, documentId, true);
      await this.requireDocumentAction(
        transaction,
        document.id,
        document.project_id,
        identity.userId,
        'document.archive',
      );
      return this.idempotent(
        transaction,
        identity.userId,
        archived ? 'document.archive' : 'document.restore',
        idempotencyKey,
        { documentId, archived, expectedVersion },
        async () => {
          if (BigInt(document.version) !== parseExpectedVersion(expectedVersion)) {
            throw new PlatformError('DOCUMENT_VERSION_CONFLICT', 'errors.conflict', 409, true);
          }
          const rows = await transaction.query<DocumentRow>(
            `UPDATE vinops.documents SET archived_at = $2::timestamptz
              WHERE id = $1::uuid
              RETURNING id, organization_id, project_id, numbering_context, code, title,
                document_type, discipline_id, classification_id, work_id, confidentiality,
                created_by, version::text, archived_at`,
            [document.id, archived ? new Date() : null],
          );
          const updated = this.one(rows);
          return this.documentOutput(
            updated,
            await this.currentRevision(transaction, updated.id, 'default'),
          );
        },
      );
    });
  }

  private async submitReview(
    transaction: Transaction,
    identity: RequestIdentity,
    revision: RevisionRow,
    input: RevisionTransitionInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    const target = revisionTransitionTarget(revision.status, 'submit_review');
    if (revision.file_status !== 'Available') {
      throw new PlatformError('FILE_NOT_AVAILABLE', 'errors.conflict', 409, false);
    }
    const reviewers = [...new Set(input.reviewerIds ?? [])];
    if (reviewers.length === 0 || reviewers.includes(revision.created_by)) {
      throw new PlatformError(
        reviewers.includes(revision.created_by)
          ? 'MAKER_CHECKER_VIOLATION'
          : 'REVIEW_ROUTE_REQUIRED',
        reviewers.includes(revision.created_by) ? 'errors.permissionDenied' : 'errors.validation',
        reviewers.includes(revision.created_by) ? 403 : 422,
        false,
      );
    }
    const policy = await this.policy(transaction, revision.project_id);
    const mode = input.reviewMode ?? policy.default_review_mode;
    const requiredApprovals =
      input.requiredApprovals ??
      (mode === 'sequential' ? reviewers.length : Math.ceil(reviewers.length / 2));
    const rejectThreshold = input.rejectThreshold ?? policy.default_reject_threshold;
    evaluateReviewRoute(
      { mode, requiredApprovals, rejectThreshold },
      reviewers.map((reviewerId, index) => ({
        reviewerId,
        sequence: mode === 'sequential' ? index + 1 : 1,
        decision: null,
      })),
    );
    const memberCount = await transaction.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vinops.project_members
        WHERE project_id = $1::uuid AND user_id = ANY($2::uuid[]) AND status = 'Active'
          AND (valid_from IS NULL OR valid_from <= now()) AND (valid_to IS NULL OR valid_to > now())`,
      [revision.project_id, reviewers],
    );
    if (Number(memberCount[0]?.count ?? '0') !== reviewers.length) {
      throw new PlatformError('REVIEWER_NOT_ELIGIBLE', 'errors.validation', 422, false);
    }
    const routeId = randomUUID();
    await transaction.execute(
      `INSERT INTO vinops.revision_review_routes (
        id, organization_id, project_id, revision_id, mode, required_approvals,
        reject_threshold, created_by
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid)`,
      [
        routeId,
        revision.organization_id,
        revision.project_id,
        revision.id,
        mode,
        requiredApprovals,
        rejectThreshold,
        identity.userId,
      ],
    );
    for (const [index, reviewerId] of reviewers.entries()) {
      await transaction.execute(
        `INSERT INTO vinops.review_assignments (
          id, organization_id, project_id, route_id, reviewer_id, sequence
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6)`,
        [
          randomUUID(),
          revision.organization_id,
          revision.project_id,
          routeId,
          reviewerId,
          mode === 'sequential' ? index + 1 : 1,
        ],
      );
    }
    return this.changeRevisionState(
      transaction,
      identity,
      revision,
      'submit_review',
      target,
      input.reason,
      correlationId,
    );
  }

  private async decideReview(
    transaction: Transaction,
    identity: RequestIdentity,
    revision: RevisionRow,
    input: RevisionTransitionInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    if (revision.status !== 'Under Review') {
      throw new PlatformError('INVALID_REVISION_TRANSITION', 'errors.conflict', 409, false);
    }
    const routes = await transaction.query<{
      id: string;
      mode: 'sequential' | 'quorum';
      required_approvals: number;
      reject_threshold: number;
    }>(
      `SELECT id, mode, required_approvals, reject_threshold
         FROM vinops.revision_review_routes WHERE revision_id = $1::uuid FOR UPDATE`,
      [revision.id],
    );
    const route = this.one(routes);
    const assignments = await transaction.query<{
      id: string;
      reviewer_id: string;
      sequence: number;
      decision: ReviewDecision | null;
    }>(
      `SELECT assignment.id, assignment.reviewer_id, assignment.sequence, decision.decision
         FROM vinops.review_assignments assignment
         LEFT JOIN vinops.review_decisions decision ON decision.assignment_id = assignment.id
        WHERE assignment.route_id = $1::uuid ORDER BY assignment.sequence, assignment.id`,
      [route.id],
    );
    const snapshot: ReviewAssignmentSnapshot[] = assignments.map((assignment) => ({
      reviewerId: assignment.reviewer_id,
      sequence: assignment.sequence,
      decision: assignment.decision,
    }));
    const before = evaluateReviewRoute(
      {
        mode: route.mode,
        requiredApprovals: route.required_approvals,
        rejectThreshold: route.reject_threshold,
      },
      snapshot,
    );
    const assignment = assignments.find((candidate) => candidate.reviewer_id === identity.userId);
    assertReviewerMayDecide({
      actorUserId: identity.userId,
      makerUserId: revision.created_by,
      actionableReviewerIds: before.actionableReviewerIds,
      existingDecision: assignment?.decision !== null && assignment?.decision !== undefined,
    });
    if (assignment === undefined) {
      throw new PlatformError('REVIEWER_NOT_ACTIONABLE', 'errors.permissionDenied', 403, false);
    }
    const decision = input.action as ReviewDecision;
    const roles = await this.roles(transaction, revision.project_id, identity.userId);
    await transaction.execute(
      `INSERT INTO vinops.review_decisions (
        id, organization_id, project_id, revision_id, assignment_id, reviewer_id,
        decision, reason, effective_roles, correlation_id
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9::text[], $10::uuid)`,
      [
        randomUUID(),
        revision.organization_id,
        revision.project_id,
        revision.id,
        assignment.id,
        identity.userId,
        decision,
        input.reason ?? null,
        roles,
        correlationId,
      ],
    );
    const after = evaluateReviewRoute(
      {
        mode: route.mode,
        requiredApprovals: route.required_approvals,
        rejectThreshold: route.reject_threshold,
      },
      snapshot.map((candidate) =>
        candidate.reviewerId === identity.userId ? { ...candidate, decision } : candidate,
      ),
    );
    await this.audit(transaction, {
      identity,
      organizationId: revision.organization_id,
      projectId: revision.project_id,
      action: `review.${decision}`,
      entityType: 'review_decision',
      entityId: assignment.id,
      correlationId,
    });
    if (!after.completed) return this.revisionOutput(revision);
    const target: RevisionStatus =
      after.outcome === 'rejected'
        ? 'Rejected'
        : after.outcome === 'approved_with_comments'
          ? 'Approved with Comments'
          : 'Approved';
    await transaction.execute(
      `UPDATE vinops.revision_review_routes SET status = $2, completed_at = now() WHERE id = $1::uuid`,
      [route.id, after.outcome === 'rejected' ? 'Rejected' : 'Complete'],
    );
    return this.changeRevisionState(
      transaction,
      identity,
      revision,
      input.action,
      target,
      input.reason,
      correlationId,
    );
  }

  private async publish(
    identity: RequestIdentity,
    revisionId: string,
    input: RevisionTransitionInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.auditedIdempotent(identity, correlationId, async (transaction) => {
      const revision = await this.revision(transaction, revisionId, false);
      await this.requireDocumentAction(
        transaction,
        revision.document_id,
        revision.project_id,
        identity.userId,
        'revision.publish',
      );
      return this.idempotent(
        transaction,
        identity.userId,
        'revision.publish',
        idempotencyKey,
        { revisionId, input },
        async () => {
          const route = this.one(
            await transaction.query<{ status: string }>(
              `SELECT status FROM vinops.revision_review_routes WHERE revision_id = $1::uuid`,
              [revision.id],
            ),
          );
          const mandatory = await transaction.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM vinops.review_comments comment
              WHERE comment.revision_id = $1::uuid AND comment.importance = 'mandatory'
                AND NOT EXISTS (SELECT 1 FROM vinops.review_comment_dispositions disposition WHERE disposition.comment_id = comment.id)`,
            [revision.id],
          );
          assertPublishAllowed({
            status: revision.status,
            fileStatus: revision.file_status,
            routeCompleted: route.status === 'Complete',
            unresolvedMandatoryComments: Number(mandatory[0]?.count ?? '0'),
            makerUserId: revision.created_by,
            publisherUserId: identity.userId,
          });
          const expectedCurrent =
            input.expectedCurrentVersion === undefined ? 0n : BigInt(input.expectedCurrentVersion);
          const result = this.one(
            await transaction.query<PublishResult>(
              `SELECT revision_id, revision_version::text, current_version::text, superseded_revision_id
                 FROM vinops.publish_document_revision($1::uuid, $2, $3::bigint, $4::bigint, $5::uuid, $6::uuid, false)`,
              [
                revision.id,
                normalizeContextKey(input.contextKey),
                parseExpectedVersion(input.expectedVersion),
                expectedCurrent,
                identity.userId,
                correlationId,
              ],
            ),
          );
          return {
            ...this.revisionOutput({
              ...revision,
              status: 'Published',
              version: result.revision_version,
            }),
            current_version: result.current_version,
            superseded_revision_id: result.superseded_revision_id,
          };
        },
      );
    });
  }

  private async changeRevisionState(
    transaction: Transaction,
    identity: RequestIdentity,
    revision: RevisionRow,
    action: RevisionAction,
    target: RevisionStatus,
    reason: string | undefined,
    correlationId: string,
  ): Promise<JsonRecord> {
    const timeColumn =
      target === 'Under Review'
        ? 'submitted_at'
        : target === 'Approved' || target === 'Approved with Comments'
          ? 'approved_at'
          : target === 'Withdrawn'
            ? 'withdrawn_at'
            : null;
    const rows = await transaction.query<{ version: string }>(
      `UPDATE vinops.document_revisions
          SET status = $2${timeColumn === null ? '' : `, ${timeColumn} = now()`}
        WHERE id = $1::uuid RETURNING version::text`,
      [revision.id, target],
    );
    const resultingVersion = this.one(rows).version;
    const roles = await this.roles(transaction, revision.project_id, identity.userId);
    await transaction.execute(
      `INSERT INTO vinops.revision_transition_history (
        id, organization_id, project_id, revision_id, action, from_state, to_state,
        reason, actor_user_id, effective_roles, expected_version, resulting_version, correlation_id
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9::uuid, $10::text[], $11::bigint, $12::bigint, $13::uuid)`,
      [
        randomUUID(),
        revision.organization_id,
        revision.project_id,
        revision.id,
        action,
        revision.status,
        target,
        reason ?? null,
        identity.userId,
        roles,
        revision.version,
        resultingVersion,
        correlationId,
      ],
    );
    await this.audit(transaction, {
      identity,
      organizationId: revision.organization_id,
      projectId: revision.project_id,
      action: `revision.${action}`,
      entityType: 'document_revision',
      entityId: revision.id,
      entityVersion: resultingVersion,
      correlationId,
    });
    await this.outbox(transaction, {
      organizationId: revision.organization_id,
      projectId: revision.project_id,
      aggregateType: 'document_revision',
      aggregateId: revision.id,
      eventType: `revision.${action}.v1`,
      payload: { revision_id: revision.id, document_id: revision.document_id, status: target },
    });
    return this.revisionOutput({ ...revision, status: target, version: resultingVersion });
  }

  private async transaction<T>(
    identity: RequestIdentity,
    correlationId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.requireDatabase().withTransaction(
        { actorUserId: identity.userId, correlationId },
        operation,
      );
    } catch (error) {
      databaseFailure(error);
    }
  }

  private async auditedIdempotent<T>(
    identity: RequestIdentity,
    correlationId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.transaction(identity, correlationId, operation);
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'IDEMPOTENCY_KEY_REUSE') {
        await this.transaction(identity, correlationId, (transaction) =>
          this.audit(transaction, {
            identity,
            action: 'idempotency.key_reuse_denied',
            entityType: 'idempotency_key',
            correlationId,
            outcome: 'denied',
          }),
        );
      }
      throw error;
    }
  }

  private async idempotent<T extends JsonRecord>(
    transaction: Transaction,
    actorUserId: string,
    operation: string,
    idempotencyKey: string,
    payload: unknown,
    action: () => Promise<T>,
  ): Promise<T> {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 255) {
      throw new PlatformError('IDEMPOTENCY_KEY_REQUIRED', 'errors.validation', 422, false);
    }
    const payloadHash = hash(stableJson(payload));
    const id = randomUUID();
    const inserted = await transaction.query<{ id: string }>(
      `INSERT INTO vinops.idempotency_keys (id, actor_user_id, operation, idempotency_key, payload_hash)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)
       ON CONFLICT (actor_user_id, operation, idempotency_key) DO NOTHING RETURNING id`,
      [id, actorUserId, operation, idempotencyKey, payloadHash],
    );
    if (inserted.length === 0) {
      const existing = this.one(
        await transaction.query<IdempotencyRow>(
          `SELECT id, payload_hash, status, response_body FROM vinops.idempotency_keys
            WHERE actor_user_id = $1::uuid AND operation = $2 AND idempotency_key = $3 FOR UPDATE`,
          [actorUserId, operation, idempotencyKey],
        ),
      );
      if (existing.payload_hash !== payloadHash) {
        throw new PlatformError('IDEMPOTENCY_KEY_REUSE', 'errors.idempotencyKeyReuse', 409, false);
      }
      if (existing.status === 'Completed' && existing.response_body !== null) {
        return record(existing.response_body) as T;
      }
      throw new PlatformError('IDEMPOTENCY_IN_PROGRESS', 'errors.conflict', 409, true);
    }
    const result = await action();
    await transaction.execute(
      `UPDATE vinops.idempotency_keys SET status = 'Completed', response_code = 200,
        response_body = $2::jsonb, completed_at = now() WHERE id = $1::uuid`,
      [id, JSON.stringify(result)],
    );
    return result;
  }

  private requireDatabase(): VinopsDatabase {
    if (this.database === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.database;
  }

  private requireStorage(): ObjectStorage {
    if (this.storage === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.storage;
  }

  private one<T>(rows: readonly T[]): T {
    const value = rows[0];
    if (value === undefined) {
      throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404, false);
    }
    return value;
  }

  private async policy(transaction: Transaction, projectId: string): Promise<ProjectPolicyRow> {
    const existing = await transaction.query<ProjectPolicyRow>(
      `SELECT project_id, organization_id, allowed_distribution_contexts, allowed_media_types,
              maximum_file_bytes::text, signed_url_ttl_seconds, default_review_mode,
              default_reject_threshold
         FROM vinops.project_document_policies WHERE project_id = $1::uuid`,
      [projectId],
    );
    if (existing[0] !== undefined) return existing[0];
    const rows = await transaction.query<ProjectPolicyRow>(
      `INSERT INTO vinops.project_document_policies (project_id, organization_id)
       SELECT project.id, project.organization_id FROM vinops.projects project WHERE project.id = $1::uuid
       RETURNING project_id, organization_id, allowed_distribution_contexts, allowed_media_types,
         maximum_file_bytes::text, signed_url_ttl_seconds, default_review_mode, default_reject_threshold`,
      [projectId],
    );
    return this.one(rows);
  }

  private async document(
    transaction: Transaction,
    documentId: string,
    forUpdate = false,
  ): Promise<DocumentRow> {
    return this.one(
      await transaction.query<DocumentRow>(
        `SELECT id, organization_id, project_id, numbering_context, code, title, document_type,
                discipline_id, classification_id, work_id, location_id, confidentiality, created_by,
                version::text, archived_at
           FROM vinops.documents WHERE id = $1::uuid${forUpdate ? ' FOR UPDATE' : ''}`,
        [documentId],
      ),
    );
  }

  private async revision(
    transaction: Transaction,
    revisionId: string,
    forUpdate: boolean,
  ): Promise<RevisionRow> {
    return this.one(
      await transaction.query<RevisionRow>(
        `${this.revisionSelect()} WHERE revision.id = $1::uuid${forUpdate ? ' FOR UPDATE OF revision' : ''}`,
        [revisionId],
      ),
    );
  }

  private async revisions(
    transaction: Transaction,
    documentId: string,
  ): Promise<readonly RevisionRow[]> {
    return transaction.query<RevisionRow>(
      `${this.revisionSelect()} WHERE revision.document_id = $1::uuid ORDER BY revision.created_at DESC, revision.id DESC`,
      [documentId],
    );
  }

  private revisionSelect(): string {
    return `SELECT revision.id, revision.organization_id, revision.project_id, revision.document_id,
      revision.revision_code, revision.purpose, revision.suitability_code, revision.status,
      revision.created_by, revision.version::text, revision.created_at, revision.published_at,
      revision.superseded_at, revision.archived_at, file.id AS file_id, file.status AS file_status,
      file.original_filename, COALESCE(file.actual_size_bytes, file.declared_size_bytes)::text AS size_bytes,
      COALESCE(file.detected_media_type, file.declared_media_type) AS media_type,
      COALESCE(file.actual_sha256, file.declared_sha256) AS sha256, file.failure_code
      FROM vinops.document_revisions revision
      JOIN vinops.document_revision_current_files current_file ON current_file.revision_id = revision.id
      JOIN vinops.revision_file_versions file_version ON file_version.id = current_file.revision_file_version_id
      JOIN vinops.file_objects file ON file.id = file_version.file_id`;
  }

  private async currentRevision(
    transaction: Transaction,
    documentId: string,
    contextKey: string,
  ): Promise<RevisionRow | null> {
    const rows = await transaction.query<RevisionRow>(
      `${this.revisionSelect()}
       JOIN vinops.document_current_revisions current_revision ON current_revision.revision_id = revision.id
       WHERE current_revision.document_id = $1::uuid AND current_revision.context_key = $2`,
      [documentId, contextKey],
    );
    return rows[0] ?? null;
  }

  private async uploadSession(
    transaction: Transaction,
    uploadSessionId: string,
    forUpdate: boolean,
  ): Promise<UploadSessionRow> {
    return this.one(
      await transaction.query<UploadSessionRow>(
        `SELECT session.id, session.organization_id, session.project_id, session.file_id,
                revision.document_id,
                session.storage_upload_id, session.status, session.expires_at,
                file.declared_size_bytes::text, file.declared_sha256,
                file.quarantine_object_key, file.status AS file_status
           FROM vinops.upload_sessions session
           JOIN vinops.file_objects file ON file.id = session.file_id
           JOIN vinops.revision_file_versions file_version ON file_version.file_id = file.id
           JOIN vinops.document_revisions revision ON revision.id = file_version.revision_id
          WHERE session.id = $1::uuid${forUpdate ? ' FOR UPDATE OF session, file' : ''}`,
        [uploadSessionId],
      ),
    );
  }

  private documentOutput(document: DocumentRow, current: RevisionRow | null): JsonRecord {
    return {
      id: document.id,
      project_id: document.project_id,
      numbering_context: document.numbering_context,
      code: document.code,
      title: document.title,
      document_type: document.document_type,
      discipline_id: document.discipline_id,
      classification_id: document.classification_id,
      work_id: document.work_id,
      location_id: document.location_id,
      confidentiality: document.confidentiality,
      version: document.version,
      archived_at: document.archived_at?.toISOString() ?? null,
      current_revision: current === null ? null : this.revisionOutput(current),
    };
  }

  private revisionOutput(revision: RevisionRow): JsonRecord {
    return {
      id: revision.id,
      document_id: revision.document_id,
      revision_code: revision.revision_code,
      purpose: revision.purpose,
      suitability_code: revision.suitability_code,
      status: revision.status,
      version: revision.version,
      created_by: revision.created_by,
      created_at:
        revision.created_at instanceof Date
          ? revision.created_at.toISOString()
          : revision.created_at,
      published_at: revision.published_at?.toISOString() ?? null,
      superseded_at: revision.superseded_at?.toISOString() ?? null,
      archived_at: revision.archived_at?.toISOString() ?? null,
      file: {
        id: revision.file_id,
        status: revision.file_status,
        filename: revision.original_filename,
        size_bytes: revision.size_bytes,
        media_type: revision.media_type,
        sha256: revision.sha256,
        failure_code: revision.failure_code,
      },
    };
  }

  private async duplicateSignal(
    transaction: Transaction,
    projectId: string,
    sha256: string,
  ): Promise<JsonRecord | null> {
    const rows = await transaction.query<{ id: string }>(
      `SELECT id FROM vinops.file_objects
        WHERE project_id = $1::uuid AND actual_sha256 = $2 AND status = 'Available'
        ORDER BY created_at LIMIT 1`,
      [projectId, sha256],
    );
    return rows[0] === undefined
      ? null
      : { possible_duplicate: true, existing_file_id: rows[0].id };
  }

  private async requireProjectMember(
    transaction: Transaction,
    projectId: string,
    userId: string,
  ): Promise<void> {
    const rows = await transaction.query<{ allowed: boolean }>(
      `SELECT vinops.can_access_project($1::uuid, $2::uuid) AS allowed`,
      [projectId, userId],
    );
    if (rows[0]?.allowed !== true) {
      throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404, false);
    }
  }

  private async roles(
    transaction: Transaction,
    projectId: string,
    userId: string,
  ): Promise<readonly string[]> {
    const rows = await transaction.query<{ roles: string[] }>(
      `SELECT roles FROM vinops.project_members WHERE project_id = $1::uuid AND user_id = $2::uuid
        AND status = 'Active' AND (valid_from IS NULL OR valid_from <= now())
        AND (valid_to IS NULL OR valid_to > now())`,
      [projectId, userId],
    );
    return rows[0]?.roles ?? [];
  }

  private async requireAction(
    transaction: Transaction,
    projectId: string,
    userId: string,
    action: string,
  ): Promise<void> {
    await this.requireProjectMember(transaction, projectId, userId);
    const roles = await this.roles(transaction, projectId, userId);
    if (!this.actionRoles(action).some((role) => roles.includes(role))) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
    const scope = await transaction.query<{ allowed: boolean }>(
      `SELECT vinops.can_read_scoped_resource(
        $1::uuid, 'project', $1::uuid, $2, $3::uuid
      ) AS allowed`,
      [projectId, action, userId],
    );
    if (scope[0]?.allowed !== true) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
  }

  private actionRoles(action: string): readonly string[] {
    const permissions: Readonly<Record<string, readonly string[]>> = {
      'document.create': ['project_admin', 'document_controller'],
      'revision.create': ['project_admin', 'document_controller'],
      'revision.submit': ['project_admin', 'document_controller'],
      'revision.withdraw': ['project_admin', 'document_controller'],
      'revision.publish': ['project_admin', 'document_controller', 'pm_cht'],
      'comment.dispose': ['project_admin', 'document_controller', 'qa_qc'],
      'annotation.create': [
        'project_admin',
        'document_controller',
        'qa_qc',
        'field_engineer',
        'assigned_reviewer',
        'assigned_approver',
        'pm_cht',
        'guest',
        'subcontractor',
      ],
      'transmittal.create': ['project_admin', 'document_controller'],
      'document.archive': ['project_admin', 'document_controller'],
    };
    return permissions[action] ?? [];
  }

  private async requireCreateDocumentAction(
    transaction: Transaction,
    projectId: string,
    userId: string,
    input: CreateDocumentInput,
  ): Promise<void> {
    await this.requireProjectMember(transaction, projectId, userId);
    const roles = await this.roles(transaction, projectId, userId);
    if (!this.actionRoles('document.create').some((role) => roles.includes(role))) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
    const scope = await transaction.query<{ allowed: boolean }>(
      `SELECT vinops.can_access_document_scope(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'document.create', $5::uuid, $6::uuid
      ) AS allowed`,
      [
        projectId,
        input.disciplineId ?? null,
        input.classificationId ?? null,
        input.workId ?? null,
        userId,
        input.locationId ?? null,
      ],
    );
    if (scope[0]?.allowed !== true) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
  }

  private async requireDocumentAction(
    transaction: Transaction,
    documentId: string,
    projectId: string,
    userId: string,
    action: string,
  ): Promise<void> {
    await this.requireProjectMember(transaction, projectId, userId);
    const roles = await this.roles(transaction, projectId, userId);
    if (!this.actionRoles(action).some((role) => roles.includes(role))) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
    const scope = await transaction.query<{ allowed: boolean }>(
      `SELECT vinops.can_access_document($1::uuid, $2, $3::uuid) AS allowed`,
      [documentId, action, userId],
    );
    if (scope[0]?.allowed !== true) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
  }

  private async requireAssignedReviewer(
    transaction: Transaction,
    revisionId: string,
    userId: string,
  ): Promise<void> {
    const rows = await transaction.query<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM vinops.review_assignments assignment
        JOIN vinops.revision_review_routes route ON route.id = assignment.route_id
        WHERE route.revision_id = $1::uuid AND assignment.reviewer_id = $2::uuid
      ) AS exists`,
      [revisionId, userId],
    );
    if (rows[0]?.exists !== true) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
  }

  private async allowedDocumentActions(
    transaction: Transaction,
    document: DocumentRow,
    userId: string,
  ): Promise<readonly string[]> {
    const roles = await this.roles(transaction, document.project_id, userId);
    const actions = ['read'];
    if (roles.some((role) => ['project_admin', 'document_controller'].includes(role))) {
      actions.push(
        'create_revision',
        document.archived_at === null ? 'archive' : 'restore',
        'transmittal',
      );
    }
    if (roles.some((role) => ['project_admin', 'document_controller', 'pm_cht'].includes(role))) {
      actions.push('publish');
    }
    return actions;
  }

  private async audit(
    transaction: Transaction,
    event: {
      identity: RequestIdentity;
      organizationId?: string;
      projectId?: string;
      action: string;
      entityType: string;
      entityId?: string;
      entityVersion?: string;
      correlationId: string;
      outcome?: 'success' | 'denied' | 'failed';
    },
  ): Promise<void> {
    const roles =
      event.projectId === undefined
        ? []
        : await this.roles(transaction, event.projectId, event.identity.userId);
    await transaction.execute(
      `INSERT INTO vinops.audit_events (
        id, organization_id, project_id, actor_user_id, effective_roles, action,
        entity_type, entity_id, entity_version, outcome, correlation_id
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text[], $6, $7, $8::uuid, $9::bigint, $10, $11::uuid)`,
      [
        randomUUID(),
        event.organizationId ?? null,
        event.projectId ?? null,
        event.identity.userId,
        roles,
        event.action,
        event.entityType,
        event.entityId ?? null,
        event.entityVersion ?? null,
        event.outcome ?? 'success',
        event.correlationId,
      ],
    );
  }

  private async outbox(
    transaction: Transaction,
    event: {
      organizationId: string;
      projectId: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: JsonRecord;
    },
  ): Promise<void> {
    await transaction.execute(
      `INSERT INTO vinops.outbox_events (
        id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::jsonb)`,
      [
        randomUUID(),
        event.organizationId,
        event.projectId,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        JSON.stringify(event.payload),
      ],
    );
  }
}
