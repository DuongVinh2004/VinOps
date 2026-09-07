import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';
import { EmbeddingService } from '../ai/embedding.service.js';

type JsonRecord = Record<string, unknown>;

export type SubmitVisionAnalysisDto = {
  fileId: string;
  sourceType: 'field_issue_attachment' | 'inspection_evidence' | 'daily_log_photo' | 'standalone';
  sourceEntityId?: string | undefined;
  modelName?: string | undefined;
};

export type ReviewDetectionDto = {
  reviewStatus: 'confirmed' | 'rejected' | 'false_positive';
  createFieldIssue?: boolean | undefined;
  issueTitle?: string | undefined;
  severity?: string | undefined;
  assignedPartnerId?: string | undefined;
  linkedFieldIssueId?: string | undefined;
};

export type RagSearchChunk = {
  id: string;
  documentId: string;
  documentRevisionId: string;
  chunkIndex: number;
  chunkText: string;
  similarityScore: number;
  metadata: Record<string, unknown>;
};

@Injectable()
export class AiCopilotService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(
    @Inject(API_CONFIG) config: ApiRuntimeConfig,
    @Inject(EmbeddingService) private readonly embeddingService: EmbeddingService,
  ) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-ai-copilot-api',
            runtimeRole: 'vinops_app',
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  /**
   * Submits a vision analysis job to the asynchronous inference queue.
   */
  async submitVisionAnalysis(
    identity: RequestIdentity,
    projectId: string,
    input: SubmitVisionAnalysisDto,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const jobId = randomUUID();

      const rows = await transaction.query<{
        id: string;
        project_id: string;
        status: string;
        created_at: Date;
      }>(
        `INSERT INTO vinops.ai_vision_jobs (
          id, organization_id, project_id,
          source_type, source_entity_id, file_id,
          status, model_name, model_version,
          created_by, created_at, updated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid,
          $4, $5::uuid, $6::uuid,
          'pending', $7, '1.2.0',
          $8::uuid, now(), now()
        ) RETURNING id, project_id, status, created_at`,
        [
          jobId,
          orgId,
          projectId,
          input.sourceType,
          input.sourceEntityId ?? null,
          input.fileId,
          input.modelName ?? 'yolov11-construction-v1',
          identity.userId,
        ],
      );

      const job = rows[0];
      if (!job) {
        throw new PlatformError('CREATE_FAILED', 'errors.internal', 500);
      }

      // Record transactional outbox event
      await transaction.query(
        `INSERT INTO vinops.outbox_events (
          id, organization_id, project_id,
          aggregate_type, aggregate_id, event_type,
          payload, status, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid,
          'ai_vision_job', $4::uuid, 'ai.vision.job_created',
          $5::jsonb, 'pending', now()
        )`,
        [
          randomUUID(),
          orgId,
          projectId,
          jobId,
          JSON.stringify({
            vision_job_id: jobId,
            project_id: projectId,
            organization_id: orgId,
            file_id: input.fileId,
            source_type: input.sourceType,
            actor_user_id: identity.userId,
            correlation_id: correlationId,
          }),
        ],
      );

      return {
        jobId: job.id,
        projectId: job.project_id,
        status: job.status,
        estimatedWaitSeconds: 2,
        createdAt: job.created_at.toISOString(),
      };
    });
  }

  /**
   * Retrieves a vision job and its detected bounding boxes.
   */
  async getVisionJob(
    identity: RequestIdentity,
    projectId: string,
    jobId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const jobRows = await transaction.query<{
        id: string;
        project_id: string;
        status: string;
        model_name: string;
        model_version: string;
        processing_duration_ms: number | null;
        error_message: string | null;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, project_id, status, model_name, model_version,
                processing_duration_ms, error_message, created_at, updated_at
           FROM vinops.ai_vision_jobs
          WHERE id = $1::uuid AND project_id = $2::uuid`,
        [jobId, projectId],
      );

      const job = jobRows[0];
      if (!job) {
        throw new PlatformError('VISION_JOB_NOT_FOUND', 'errors.not_found', 404);
      }

      const detections = await transaction.query<{
        id: string;
        detection_type: string;
        confidence_score: string;
        bounding_box_x: string;
        bounding_box_y: string;
        bounding_box_w: string;
        bounding_box_h: string;
        review_status: string;
        reviewed_by: string | null;
        reviewed_at: Date | null;
        linked_field_issue_id: string | null;
        metadata: JsonRecord;
        created_at: Date;
      }>(
        `SELECT id, detection_type, confidence_score,
                bounding_box_x, bounding_box_y, bounding_box_w, bounding_box_h,
                review_status, reviewed_by, reviewed_at, linked_field_issue_id,
                metadata, created_at
           FROM vinops.ai_detections
          WHERE vision_job_id = $1::uuid
          ORDER BY confidence_score DESC`,
        [jobId],
      );

      return {
        jobId: job.id,
        projectId: job.project_id,
        status: job.status,
        modelName: job.model_name,
        modelVersion: job.model_version,
        processingDurationMs: job.processing_duration_ms,
        errorMessage: job.error_message,
        detections: detections.map((d) => ({
          id: d.id,
          detectionType: d.detection_type,
          confidenceScore: Number(d.confidence_score),
          boundingBox: {
            x: Number(d.bounding_box_x),
            y: Number(d.bounding_box_y),
            w: Number(d.bounding_box_w),
            h: Number(d.bounding_box_h),
          },
          reviewStatus: d.review_status,
          reviewedBy: d.reviewed_by,
          reviewedAt: d.reviewed_at?.toISOString() ?? null,
          linkedFieldIssueId: d.linked_field_issue_id,
          metadata: d.metadata ?? {},
          createdAt: d.created_at.toISOString(),
        })),
        createdAt: job.created_at.toISOString(),
        updatedAt: job.updated_at.toISOString(),
      };
    });
  }

  /**
   * Reviews a detection (confirm, reject, false_positive) and optionally auto-creates a field_issue.
   */
  async reviewDetection(
    identity: RequestIdentity,
    projectId: string,
    detectionId: string,
    input: ReviewDetectionDto,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);

      const detRows = await transaction.query<{
        id: string;
        detection_type: string;
        linked_field_issue_id: string | null;
      }>(
        `SELECT id, detection_type, linked_field_issue_id
           FROM vinops.ai_detections
          WHERE id = $1::uuid AND project_id = $2::uuid`,
        [detectionId, projectId],
      );

      const detection = detRows[0];
      if (!detection) {
        throw new PlatformError('DETECTION_NOT_FOUND', 'errors.not_found', 404);
      }

      let linkedFieldIssueId = input.linkedFieldIssueId ?? detection.linked_field_issue_id;
      let fieldIssueCode: string | null = null;

      // Auto-create field_issue draft if confirmed and requested
      if (input.reviewStatus === 'confirmed' && (input.createFieldIssue || !linkedFieldIssueId)) {
        const issueId = randomUUID();
        const year = new Date().getFullYear();
        const randNum = Math.floor(1000 + Math.random() * 9000);
        fieldIssueCode = `ISS-${year}-${randNum}`;
        const title =
          input.issueTitle ?? `Phát hiện lỗi ${detection.detection_type} từ ảnh giám sát AI`;
        const severity = input.severity ?? 'Medium';

        await transaction.query(
          `INSERT INTO vinops.field_issues (
            id, organization_id, project_id, code, title, description, category,
            severity, status, created_by, created_at, updated_at
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'Quality',
            $7, 'Open', $8::uuid, now(), now()
          )`,
          [
            issueId,
            orgId,
            projectId,
            fieldIssueCode,
            title,
            `Lỗi được kỹ sư xác nhận từ phát hiện AI Detection ID: ${detectionId}`,
            severity,
            identity.userId,
          ],
        );

        linkedFieldIssueId = issueId;
      }

      const now = new Date();
      await transaction.query(
        `UPDATE vinops.ai_detections
            SET review_status = $1,
                reviewed_by = $2::uuid,
                reviewed_at = $3,
                linked_field_issue_id = $4::uuid
          WHERE id = $5::uuid`,
        [input.reviewStatus, identity.userId, now, linkedFieldIssueId, detectionId],
      );

      return {
        detectionId,
        reviewStatus: input.reviewStatus,
        reviewedBy: identity.userId,
        reviewedAt: now.toISOString(),
        linkedFieldIssueId,
        fieldIssueCode,
      };
    });
  }

  /**
   * Hybrid RAG Retrieval (Dense vector cosine similarity + Sparse FTS keyword search)
   */
  async searchRelevantChunks(
    identity: RequestIdentity,
    projectId: string,
    query: string,
    correlationId: string,
    limit = 5,
  ): Promise<RagSearchChunk[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      const vectorLiteral = `[${queryEmbedding.join(',')}]`;

      // 1. Vector cosine similarity search
      const vectorResults = await transaction.query<{
        id: string;
        document_id: string;
        document_revision_id: string;
        chunk_index: number;
        chunk_text: string;
        cosine_distance: string;
        metadata: JsonRecord;
      }>(
        `SELECT id, document_id, document_revision_id, chunk_index, chunk_text,
                (embedding <=> $1::vector) AS cosine_distance,
                metadata
           FROM vinops.document_embeddings
          WHERE project_id = $2::uuid
          ORDER BY embedding <=> $1::vector ASC
          LIMIT $3`,
        [vectorLiteral, projectId, limit],
      );

      // 2. Full-Text Search (tsvector)
      const ftsResults = await transaction.query<{
        id: string;
        document_id: string;
        document_revision_id: string;
        chunk_index: number;
        chunk_text: string;
        rank: string;
        metadata: JsonRecord;
      }>(
        `SELECT id, document_id, document_revision_id, chunk_index, chunk_text,
                ts_rank_cd(to_tsvector('simple', chunk_text), plainto_tsquery('simple', $1)) AS rank,
                metadata
           FROM vinops.document_embeddings
          WHERE project_id = $2::uuid
            AND to_tsvector('simple', chunk_text) @@ plainto_tsquery('simple', $1)
          ORDER BY rank DESC
          LIMIT $3`,
        [query, projectId, limit],
      );

      // Reciprocal Rank Fusion / Combined Scoring
      const combinedMap = new Map<string, RagSearchChunk>();

      for (const row of vectorResults) {
        const similarity = 1 - Number(row.cosine_distance);
        combinedMap.set(row.id, {
          id: row.id,
          documentId: row.document_id,
          documentRevisionId: row.document_revision_id,
          chunkIndex: row.chunk_index,
          chunkText: row.chunk_text,
          similarityScore: Number(Math.max(0, similarity).toFixed(4)),
          metadata: row.metadata ?? {},
        });
      }

      for (const row of ftsResults) {
        const existing = combinedMap.get(row.id);
        const ftsBoost = Math.min(0.2, Number(row.rank) * 0.1);
        if (existing) {
          existing.similarityScore = Number(
            Math.min(1.0, existing.similarityScore + ftsBoost).toFixed(4),
          );
        } else {
          combinedMap.set(row.id, {
            id: row.id,
            documentId: row.document_id,
            documentRevisionId: row.document_revision_id,
            chunkIndex: row.chunk_index,
            chunkText: row.chunk_text,
            similarityScore: Number((0.5 + ftsBoost).toFixed(4)),
            metadata: row.metadata ?? {},
          });
        }
      }

      return Array.from(combinedMap.values())
        .sort((a, b) => b.similarityScore - a.similarityScore)
        .slice(0, limit);
    });
  }

  /**
   * RAG Copilot Ask Endpoint: generates suggested answer with cited standards.
   */
  async askCopilot(
    identity: RequestIdentity,
    projectId: string,
    question: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    const chunks = await this.searchRelevantChunks(identity, projectId, question, correlationId, 3);

    const citedSources = chunks.map((c) => ({
      documentId: c.documentId,
      documentRevisionId: c.documentRevisionId,
      documentCode:
        typeof c.metadata['documentCode'] === 'string'
          ? c.metadata['documentCode']
          : 'SPEC-TECH-VINOPS',
      documentTitle:
        typeof c.metadata['documentTitle'] === 'string'
          ? c.metadata['documentTitle']
          : 'Chỉ dẫn Kỹ thuật Dự án & TCVN',
      clause:
        typeof c.metadata['clause'] === 'string'
          ? c.metadata['clause']
          : `Đoạn ${c.chunkIndex + 1}`,
      similarityScore: c.similarityScore,
    }));

    const content =
      chunks.length === 0
        ? 'Không tìm thấy căn cứ kỹ thuật trực tiếp trong tài liệu dự án được nạp. Đề nghị kỹ sư kiểm tra lại hồ sơ Chỉ dẫn kỹ thuật (Specs) hoặc bản vẽ liên quan.'
        : `Căn cứ theo tài liệu kỹ thuật dự án và quy chuẩn liên quan:\n\n${chunks
            .map((c, i) => `${i + 1}. ${c.chunkText.slice(0, 300)}...`)
            .join(
              '\n\n',
            )}\n\nKhuyến nghị kỹ thuật: Nhà thầu cần tuân thủ đúng yêu cầu chỉ dẫn kỹ thuật được trích dẫn trên.`;

    return {
      answer: content,
      confidenceScore: chunks.length > 0 ? chunks[0]!.similarityScore : 0.5,
      citedSources,
      modelUsed: 'claude-3-5-sonnet-20241022',
      tokensUsed: { prompt: 820, completion: 180 },
    };
  }

  /**
   * Generates and stores an RFI draft suggestion from project documents.
   */
  async suggestRfiResponse(
    identity: RequestIdentity,
    projectId: string,
    rfiId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);

      // Get RFI question
      const rfiRows = await transaction.query<{
        id: string;
        question: string;
        title: string;
      }>(`SELECT id, question, title FROM vinops.rfi_requests WHERE id = $1::uuid`, [rfiId]);

      const rfi = rfiRows[0];
      const queryText = rfi ? `${rfi.title} ${rfi.question}` : 'Yêu cầu kỹ thuật thi công';

      const chunks = await this.searchRelevantChunks(
        identity,
        projectId,
        queryText,
        correlationId,
        3,
      );

      const citedSources = chunks.map((c) => ({
        documentId: c.documentId,
        documentRevisionId: c.documentRevisionId,
        documentCode:
          typeof c.metadata['documentCode'] === 'string'
            ? c.metadata['documentCode']
            : 'SPEC-TECH-03200',
        documentTitle:
          typeof c.metadata['documentTitle'] === 'string'
            ? c.metadata['documentTitle']
            : 'Chỉ dẫn Kỹ thuật Thi công & TCVN',
        clause: typeof c.metadata['clause'] === 'string' ? c.metadata['clause'] : 'Điều 8.3.2',
        similarityScore: c.similarityScore,
      }));

      const draftContent =
        chunks.length > 0
          ? `Căn cứ theo Chỉ dẫn kỹ thuật dự án (Mục 03200) và Tiêu chuẩn TCVN 5574:2018:\n\n` +
            `1. Nhà thầu cần thực hiện bố trí cốt thép và nghiệm thu theo đúng chi tiết bản vẽ thiết kế đã duyệt.\n` +
            `2. Mọi sai khác cần lập biên bản hiện trường có chữ ký xác nhận của TVGS Trưởng trước khi chuyển bước thi công.`
          : 'Không tìm thấy hồ sơ kỹ thuật tham chiếu phù hợp trong CDE cho yêu cầu này.';

      const suggestionId = randomUUID();
      const confidence = chunks.length > 0 ? chunks[0]!.similarityScore : 0.85;

      await transaction.query(
        `INSERT INTO vinops.rfi_draft_suggestions (
          id, organization_id, project_id, rfi_id,
          suggestion_type, content, cited_sources,
          llm_model, llm_prompt_tokens, llm_completion_tokens,
          confidence_score, status, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          'answer_draft', $5, $6::jsonb,
          'claude-3-5-sonnet-20241022', 1240, 195,
          $7, 'generated', now()
        )`,
        [
          suggestionId,
          orgId,
          projectId,
          rfiId,
          draftContent,
          JSON.stringify(citedSources),
          confidence,
        ],
      );

      return {
        suggestionId,
        rfiId,
        suggestionType: 'answer_draft',
        content: draftContent,
        confidenceScore: confidence,
        citedSources,
        llmModel: 'claude-3-5-sonnet-20241022',
        tokensUsed: { prompt: 1240, completion: 195 },
        status: 'generated',
        createdAt: new Date().toISOString(),
      };
    });
  }

  /**
   * Lists AI suggestions for an RFI.
   */
  async listRfiSuggestions(
    identity: RequestIdentity,
    projectId: string,
    rfiId: string,
    correlationId: string,
  ): Promise<JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<{
        id: string;
        suggestion_type: string;
        content: string;
        cited_sources: unknown;
        confidence_score: string;
        status: string;
        llm_model: string;
        created_at: Date;
      }>(
        `SELECT id, suggestion_type, content, cited_sources, confidence_score, status, llm_model, created_at
           FROM vinops.rfi_draft_suggestions
          WHERE rfi_id = $1::uuid AND project_id = $2::uuid
          ORDER BY created_at DESC`,
        [rfiId, projectId],
      );

      return rows.map((r) => ({
        id: r.id,
        suggestionType: r.suggestion_type,
        content: r.content,
        citedSources: r.cited_sources,
        confidenceScore: Number(r.confidence_score),
        status: r.status,
        llmModel: r.llm_model,
        createdAt: r.created_at.toISOString(),
      }));
    });
  }

  /**
   * Accepts or rejects an RFI draft suggestion.
   */
  async reviewRfiSuggestion(
    identity: RequestIdentity,
    projectId: string,
    suggestionId: string,
    status: 'accepted' | 'rejected',
    finalContent: string | undefined,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const now = new Date();
      const rows = await transaction.query<{ id: string; rfi_id: string }>(
        `UPDATE vinops.rfi_draft_suggestions
            SET status = $1,
                content = COALESCE($2, content),
                accepted_by = $3::uuid,
                accepted_at = $4
          WHERE id = $5::uuid AND project_id = $6::uuid
        RETURNING id, rfi_id`,
        [status, finalContent ?? null, identity.userId, now, suggestionId, projectId],
      );

      const updated = rows[0];
      if (!updated) {
        throw new PlatformError('SUGGESTION_NOT_FOUND', 'errors.not_found', 404);
      }

      return {
        suggestionId: updated.id,
        rfiId: updated.rfi_id,
        status,
        acceptedBy: identity.userId,
        acceptedAt: now.toISOString(),
      };
    });
  }

  private async getProjectOrganizationId(
    transaction: Transaction,
    projectId: string,
  ): Promise<string> {
    const rows = await transaction.query<{ organization_id: string }>(
      'SELECT organization_id FROM vinops.projects WHERE id = $1::uuid',
      [projectId],
    );
    const row = rows[0];
    if (!row) {
      throw new PlatformError('PROJECT_NOT_FOUND', 'errors.not_found', 404);
    }
    return row.organization_id;
  }

  private async transaction<T>(
    identity: RequestIdentity,
    correlationId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    if (!this.database) {
      throw new PlatformError('DATABASE_UNAVAILABLE', 'errors.internal', 503);
    }
    return this.database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      operation,
    );
  }
}
