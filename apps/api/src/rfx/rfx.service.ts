import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import {
  addWorkingDays,
  computeRfiBallInCourt,
  computeSubmittalBallInCourt,
  defaultProjectCalendar,
  evaluateSlaStatus,
  reviewDecisionToSubmittalAction,
  rfiTransitionTarget,
  submittalTransitionTarget,
  type ProjectCalendarConfig,
  type RfiAction,
  type RfiPriority,
  type RfiStatus,
  type SubmittalAction,
  type SubmittalReviewDecision,
  type SubmittalReviewStage,
  type SubmittalStatus,
  type SubmittalType,
} from '@vinops/domain';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';

type JsonRecord = Record<string, unknown>;

export type CreateRfiInput = {
  code: string;
  title: string;
  question: string;
  suggestedSolution?: string | undefined;
  priority?: RfiPriority | undefined;
  locationNodeId?: string | undefined;
  workNodeId?: string | undefined;
  documentId?: string | undefined;
  requestingPartnerOrganizationId: string;
  respondingPartnerOrganizationId?: string | undefined;
  sourceIssueId?: string | undefined;
  slaBusinessDays?: number | undefined;
};

export type CreateRfiResponseInput = {
  responseType: 'clarification_request' | 'clarification_answer' | 'official_answer';
  content: string;
  revisedDocumentId?: string | undefined;
  revisedDocumentRevisionId?: string | undefined;
  fileId?: string | undefined;
};

export type CreateSubmittalItemInput = {
  itemNumber: number;
  description: string;
  manufacturer?: string | undefined;
  modelOrGrade?: string | undefined;
  sampleQuantity?: number | undefined;
  physicalSampleReceived?: boolean | undefined;
  documentId?: string | undefined;
  fileId?: string | undefined;
};

export type CreateSubmittalInput = {
  code: string;
  title: string;
  submittalType: SubmittalType;
  makerPartnerOrganizationId: string;
  leadContractorPartnerOrganizationId?: string | undefined;
  consultantPartnerOrganizationId?: string | undefined;
  locationNodeId?: string | undefined;
  workNodeId?: string | undefined;
  specificationDocumentId?: string | undefined;
  drawingDocumentId?: string | undefined;
  slaBusinessDays?: number | undefined;
  items?: readonly CreateSubmittalItemInput[] | undefined;
};

export type CreateSubmittalReviewInput = {
  stage: SubmittalReviewStage;
  decision: SubmittalReviewDecision;
  comments: string;
  attachedFileId?: string | undefined;
};

type RfiRequestRow = {
  id: string;
  organization_id: string;
  project_id: string;
  code: string;
  title: string;
  question: string;
  suggested_solution: string | null;
  status: string;
  priority: string;
  location_node_id: string | null;
  work_node_id: string | null;
  document_id: string | null;
  requesting_partner_organization_id: string;
  responding_partner_organization_id: string | null;
  ball_in_court_organization_id: string | null;
  source_issue_id: string | null;
  calendar_id: string | null;
  submitted_at: Date | null;
  due_at: Date | null;
  sla_business_days: number;
  answered_at: Date | null;
  closed_at: Date | null;
  version: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type RfiResponseRow = {
  id: string;
  rfi_id: string;
  response_type: string;
  content: string;
  author_user_id: string;
  author_partner_organization_id: string | null;
  revised_document_id: string | null;
  revised_document_revision_id: string | null;
  file_id: string | null;
  created_at: Date;
};

type SubmittalRow = {
  id: string;
  organization_id: string;
  project_id: string;
  code: string;
  title: string;
  submittal_type: string;
  status: string;
  maker_partner_organization_id: string;
  lead_contractor_partner_organization_id: string | null;
  consultant_partner_organization_id: string | null;
  ball_in_court_organization_id: string | null;
  location_node_id: string | null;
  work_node_id: string | null;
  specification_document_id: string | null;
  drawing_document_id: string | null;
  calendar_id: string | null;
  submitted_at: Date | null;
  due_at: Date | null;
  sla_business_days: number;
  version: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type SubmittalItemRow = {
  id: string;
  submittal_id: string;
  item_number: number;
  description: string;
  manufacturer: string | null;
  model_or_grade: string | null;
  sample_quantity: number;
  physical_sample_received: boolean;
  document_id: string | null;
  file_id: string | null;
  created_at: Date;
};

type SubmittalReviewRow = {
  id: string;
  submittal_id: string;
  stage: string;
  reviewer_user_id: string;
  reviewer_partner_organization_id: string | null;
  decision: string;
  comments: string;
  attached_file_id: string | null;
  reviewed_at: Date;
};

@Injectable()
export class RfxService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(@Inject(API_CONFIG) config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-rfx-api',
            runtimeRole: 'vinops_app',
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  // ====================== RFI METHODS ======================

  async createRfi(
    identity: RequestIdentity,
    projectId: string,
    input: CreateRfiInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const calendar = await this.getProjectCalendar(transaction, projectId);

      const slaDays = input.slaBusinessDays ?? 5;
      const submittedAt = new Date();
      const dueAt = addWorkingDays(submittedAt, slaDays, calendar);
      const bic = input.respondingPartnerOrganizationId ?? input.requestingPartnerOrganizationId;

      const rfiId = randomUUID();
      const rows = await transaction.query<RfiRequestRow>(
        `INSERT INTO vinops.rfi_requests (
          id, organization_id, project_id, code, title, question, suggested_solution,
          status, priority, location_node_id, work_node_id, document_id,
          requesting_partner_organization_id, responding_partner_organization_id,
          ball_in_court_organization_id, source_issue_id, submitted_at, due_at,
          sla_business_days, created_by
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
          'Submitted', $8, $9::uuid, $10::uuid, $11::uuid,
          $12::uuid, $13::uuid, $14::uuid, $15::uuid, $16, $17,
          $18, $19::uuid
        ) RETURNING *`,
        [
          rfiId,
          orgId,
          projectId,
          input.code.trim(),
          input.title.trim(),
          input.question.trim(),
          input.suggestedSolution?.trim() ?? null,
          input.priority ?? 'normal',
          input.locationNodeId ?? null,
          input.workNodeId ?? null,
          input.documentId ?? null,
          input.requestingPartnerOrganizationId,
          input.respondingPartnerOrganizationId ?? null,
          bic,
          input.sourceIssueId ?? null,
          submittedAt,
          dueAt,
          slaDays,
          identity.userId,
        ],
      );

      const created = rows[0]!;

      await this.outbox(transaction, {
        organizationId: orgId,
        projectId,
        aggregateType: 'rfi_request',
        aggregateId: rfiId,
        eventType: 'rfi.created.v1',
        payload: { rfi_id: rfiId, code: created.code, status: created.status },
      });

      return this.formatRfi(created, []);
    });
  }

  async listRfis(
    identity: RequestIdentity,
    projectId: string,
    filters: {
      status?: string | undefined;
      ballInCourtOrganizationId?: string | undefined;
    },
    correlationId: string,
  ): Promise<readonly JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      await this.requireProjectAccess(transaction, projectId, identity.userId);

      const conditions: string[] = ['project_id = $1::uuid'];
      const params: unknown[] = [projectId];

      if (filters.status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(filters.status);
      }
      if (filters.ballInCourtOrganizationId) {
        conditions.push(`ball_in_court_organization_id = $${params.length + 1}::uuid`);
        params.push(filters.ballInCourtOrganizationId);
      }

      const rows = await transaction.query<RfiRequestRow>(
        `SELECT * FROM vinops.rfi_requests WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
        params,
      );

      return rows.map((r) => this.formatRfi(r));
    });
  }

  async getRfi(
    identity: RequestIdentity,
    projectId: string,
    rfiId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      await this.requireProjectAccess(transaction, projectId, identity.userId);

      const rows = await transaction.query<RfiRequestRow>(
        `SELECT * FROM vinops.rfi_requests WHERE id = $1::uuid AND project_id = $2::uuid`,
        [rfiId, projectId],
      );
      const rfi = rows[0];
      if (!rfi) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const responses = await transaction.query<RfiResponseRow>(
        `SELECT * FROM vinops.rfi_responses WHERE rfi_id = $1::uuid ORDER BY created_at ASC`,
        [rfiId],
      );

      return this.formatRfi(rfi, responses);
    });
  }

  async transitionRfi(
    identity: RequestIdentity,
    projectId: string,
    rfiId: string,
    action: RfiAction,
    comment: string | undefined,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<RfiRequestRow>(
        `SELECT * FROM vinops.rfi_requests WHERE id = $1::uuid AND project_id = $2::uuid FOR UPDATE`,
        [rfiId, projectId],
      );
      const rfi = rows[0];
      if (!rfi) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const targetStatus = rfiTransitionTarget(rfi.status as RfiStatus, action);
      const bic = computeRfiBallInCourt(targetStatus, {
        requestingPartnerOrganizationId: rfi.requesting_partner_organization_id,
        respondingPartnerOrganizationId: rfi.responding_partner_organization_id,
      });

      const answeredAt = targetStatus === 'Official Answered' ? new Date() : rfi.answered_at;
      const closedAt = targetStatus === 'Closed' ? new Date() : rfi.closed_at;

      const updated = await transaction.query<RfiRequestRow>(
        `UPDATE vinops.rfi_requests
            SET status = $1,
                ball_in_court_organization_id = $2::uuid,
                answered_at = $3,
                closed_at = $4
          WHERE id = $5::uuid
          RETURNING *`,
        [targetStatus, bic, answeredAt, closedAt, rfiId],
      );

      await this.outbox(transaction, {
        organizationId: rfi.organization_id,
        projectId,
        aggregateType: 'rfi_request',
        aggregateId: rfiId,
        eventType: 'rfi.transitioned.v1',
        payload: { rfi_id: rfiId, from: rfi.status, to: targetStatus, action, comment },
      });

      return this.formatRfi(updated[0]!);
    });
  }

  async createRfiResponse(
    identity: RequestIdentity,
    projectId: string,
    rfiId: string,
    input: CreateRfiResponseInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<RfiRequestRow>(
        `SELECT * FROM vinops.rfi_requests WHERE id = $1::uuid AND project_id = $2::uuid FOR UPDATE`,
        [rfiId, projectId],
      );
      const rfi = rows[0];
      if (!rfi) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const responseId = randomUUID();
      const partnerOrgId = await this.getUserPartnerOrganizationId(
        transaction,
        projectId,
        identity.userId,
      );

      const respRows = await transaction.query<RfiResponseRow>(
        `INSERT INTO vinops.rfi_responses (
          id, organization_id, project_id, rfi_id, response_type, content,
          author_user_id, author_partner_organization_id, revised_document_id,
          revised_document_revision_id, file_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
          $7::uuid, $8::uuid, $9::uuid, $10::uuid, $11::uuid
        ) RETURNING *`,
        [
          responseId,
          rfi.organization_id,
          projectId,
          rfiId,
          input.responseType,
          input.content.trim(),
          identity.userId,
          partnerOrgId ?? null,
          input.revisedDocumentId ?? null,
          input.revisedDocumentRevisionId ?? null,
          input.fileId ?? null,
        ],
      );

      // Auto-transition RFI status depending on response type
      let newStatus: RfiStatus | undefined;
      if (input.responseType === 'official_answer') {
        newStatus = 'Official Answered';
      } else if (input.responseType === 'clarification_request') {
        newStatus = 'Clarification Required';
      } else if (input.responseType === 'clarification_answer') {
        newStatus = 'Under Review';
      }

      if (newStatus && newStatus !== rfi.status) {
        const bic = computeRfiBallInCourt(newStatus, {
          requestingPartnerOrganizationId: rfi.requesting_partner_organization_id,
          respondingPartnerOrganizationId: rfi.responding_partner_organization_id,
        });
        await transaction.execute(
          `UPDATE vinops.rfi_requests
              SET status = $1,
                  ball_in_court_organization_id = $2::uuid,
                  answered_at = CASE WHEN $1 = 'Official Answered' THEN now() ELSE answered_at END
            WHERE id = $3::uuid`,
          [newStatus, bic, rfiId],
        );
      }

      await this.outbox(transaction, {
        organizationId: rfi.organization_id,
        projectId,
        aggregateType: 'rfi_request',
        aggregateId: rfiId,
        eventType: 'rfi.response_added.v1',
        payload: {
          rfi_id: rfiId,
          response_id: responseId,
          response_type: input.responseType,
          new_status: newStatus ?? rfi.status,
        },
      });

      const resp = respRows[0]!;
      return {
        id: resp.id,
        rfi_id: resp.rfi_id,
        response_type: resp.response_type,
        content: resp.content,
        author_user_id: resp.author_user_id,
        author_partner_organization_id: resp.author_partner_organization_id,
        revised_document_id: resp.revised_document_id,
        revised_document_revision_id: resp.revised_document_revision_id,
        file_id: resp.file_id,
        created_at: resp.created_at.toISOString(),
      };
    });
  }

  // ====================== SUBMITTAL METHODS ======================

  async createSubmittal(
    identity: RequestIdentity,
    projectId: string,
    input: CreateSubmittalInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const calendar = await this.getProjectCalendar(transaction, projectId);

      const slaDays = input.slaBusinessDays ?? 7;
      const submittedAt = new Date();
      const dueAt = addWorkingDays(submittedAt, slaDays, calendar);
      const bic =
        input.leadContractorPartnerOrganizationId ?? input.consultantPartnerOrganizationId ?? null;

      const submittalId = randomUUID();
      const rows = await transaction.query<SubmittalRow>(
        `INSERT INTO vinops.submittals (
          id, organization_id, project_id, code, title, submittal_type,
          status, maker_partner_organization_id, lead_contractor_partner_organization_id,
          consultant_partner_organization_id, ball_in_court_organization_id,
          location_node_id, work_node_id, specification_document_id, drawing_document_id,
          submitted_at, due_at, sla_business_days, created_by
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
          'Submitted', $7::uuid, $8::uuid, $9::uuid, $10::uuid,
          $11::uuid, $12::uuid, $13::uuid, $14::uuid,
          $15, $16, $17, $18::uuid
        ) RETURNING *`,
        [
          submittalId,
          orgId,
          projectId,
          input.code.trim(),
          input.title.trim(),
          input.submittalType,
          input.makerPartnerOrganizationId,
          input.leadContractorPartnerOrganizationId ?? null,
          input.consultantPartnerOrganizationId ?? null,
          bic,
          input.locationNodeId ?? null,
          input.workNodeId ?? null,
          input.specificationDocumentId ?? null,
          input.drawingDocumentId ?? null,
          submittedAt,
          dueAt,
          slaDays,
          identity.userId,
        ],
      );

      const created = rows[0]!;

      // Insert items if provided
      const items: SubmittalItemRow[] = [];
      if (input.items && input.items.length > 0) {
        for (const it of input.items) {
          const itemRows = await transaction.query<SubmittalItemRow>(
            `INSERT INTO vinops.submittal_items (
              id, organization_id, project_id, submittal_id, item_number,
              description, manufacturer, model_or_grade, sample_quantity,
              physical_sample_received, document_id, file_id
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
              $6, $7, $8, $9, $10, $11::uuid, $12::uuid
            ) RETURNING *`,
            [
              randomUUID(),
              orgId,
              projectId,
              submittalId,
              it.itemNumber,
              it.description.trim(),
              it.manufacturer?.trim() ?? null,
              it.modelOrGrade?.trim() ?? null,
              it.sampleQuantity ?? 1,
              it.physicalSampleReceived ?? false,
              it.documentId ?? null,
              it.fileId ?? null,
            ],
          );
          if (itemRows[0]) items.push(itemRows[0]);
        }
      }

      await this.outbox(transaction, {
        organizationId: orgId,
        projectId,
        aggregateType: 'submittal',
        aggregateId: submittalId,
        eventType: 'submittal.created.v1',
        payload: { submittal_id: submittalId, code: created.code, status: created.status },
      });

      return this.formatSubmittal(created, items, []);
    });
  }

  async listSubmittals(
    identity: RequestIdentity,
    projectId: string,
    filters: {
      status?: string | undefined;
      submittalType?: string | undefined;
    },
    correlationId: string,
  ): Promise<readonly JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      await this.requireProjectAccess(transaction, projectId, identity.userId);

      const conditions: string[] = ['project_id = $1::uuid'];
      const params: unknown[] = [projectId];

      if (filters.status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(filters.status);
      }
      if (filters.submittalType) {
        conditions.push(`submittal_type = $${params.length + 1}`);
        params.push(filters.submittalType);
      }

      const rows = await transaction.query<SubmittalRow>(
        `SELECT * FROM vinops.submittals WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
        params,
      );

      return rows.map((s) => this.formatSubmittal(s));
    });
  }

  async getSubmittal(
    identity: RequestIdentity,
    projectId: string,
    submittalId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      await this.requireProjectAccess(transaction, projectId, identity.userId);

      const rows = await transaction.query<SubmittalRow>(
        `SELECT * FROM vinops.submittals WHERE id = $1::uuid AND project_id = $2::uuid`,
        [submittalId, projectId],
      );
      const submittal = rows[0];
      if (!submittal) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const items = await transaction.query<SubmittalItemRow>(
        `SELECT * FROM vinops.submittal_items WHERE submittal_id = $1::uuid ORDER BY item_number ASC`,
        [submittalId],
      );
      const reviews = await transaction.query<SubmittalReviewRow>(
        `SELECT * FROM vinops.submittal_reviews WHERE submittal_id = $1::uuid ORDER BY reviewed_at ASC`,
        [submittalId],
      );

      return this.formatSubmittal(submittal, items, reviews);
    });
  }

  async transitionSubmittal(
    identity: RequestIdentity,
    projectId: string,
    submittalId: string,
    action: SubmittalAction,
    comment: string | undefined,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<SubmittalRow>(
        `SELECT * FROM vinops.submittals WHERE id = $1::uuid AND project_id = $2::uuid FOR UPDATE`,
        [submittalId, projectId],
      );
      const submittal = rows[0];
      if (!submittal) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const targetStatus = submittalTransitionTarget(submittal.status as SubmittalStatus, action);
      const bic = computeSubmittalBallInCourt(targetStatus, {
        makerPartnerOrganizationId: submittal.maker_partner_organization_id,
        leadContractorPartnerOrganizationId: submittal.lead_contractor_partner_organization_id,
        consultantPartnerOrganizationId: submittal.consultant_partner_organization_id,
      });

      const updated = await transaction.query<SubmittalRow>(
        `UPDATE vinops.submittals
            SET status = $1,
                ball_in_court_organization_id = $2::uuid
          WHERE id = $3::uuid
          RETURNING *`,
        [targetStatus, bic, submittalId],
      );

      await this.outbox(transaction, {
        organizationId: submittal.organization_id,
        projectId,
        aggregateType: 'submittal',
        aggregateId: submittalId,
        eventType: 'submittal.transitioned.v1',
        payload: {
          submittal_id: submittalId,
          from: submittal.status,
          to: targetStatus,
          action,
          comment,
        },
      });

      return this.formatSubmittal(updated[0]!);
    });
  }

  async createSubmittalReview(
    identity: RequestIdentity,
    projectId: string,
    submittalId: string,
    input: CreateSubmittalReviewInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<SubmittalRow>(
        `SELECT * FROM vinops.submittals WHERE id = $1::uuid AND project_id = $2::uuid FOR UPDATE`,
        [submittalId, projectId],
      );
      const submittal = rows[0];
      if (!submittal) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const action = reviewDecisionToSubmittalAction(input.decision);
      let targetStatus: SubmittalStatus;

      if (input.stage === 'checker') {
        // Checker review advances Submitted to Under Review
        targetStatus = input.decision === 'Rejected' ? 'Rejected' : 'Under Review';
      } else {
        targetStatus = submittalTransitionTarget(submittal.status as SubmittalStatus, action);
      }

      const bic = computeSubmittalBallInCourt(targetStatus, {
        makerPartnerOrganizationId: submittal.maker_partner_organization_id,
        leadContractorPartnerOrganizationId: submittal.lead_contractor_partner_organization_id,
        consultantPartnerOrganizationId: submittal.consultant_partner_organization_id,
      });

      const partnerOrgId = await this.getUserPartnerOrganizationId(
        transaction,
        projectId,
        identity.userId,
      );

      const reviewId = randomUUID();
      const revRows = await transaction.query<SubmittalReviewRow>(
        `INSERT INTO vinops.submittal_reviews (
          id, organization_id, project_id, submittal_id, stage, reviewer_user_id,
          reviewer_partner_organization_id, decision, comments, attached_file_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid,
          $7::uuid, $8, $9, $10::uuid
        ) RETURNING *`,
        [
          reviewId,
          submittal.organization_id,
          projectId,
          submittalId,
          input.stage,
          identity.userId,
          partnerOrgId ?? null,
          input.decision,
          input.comments.trim(),
          input.attachedFileId ?? null,
        ],
      );

      await transaction.execute(
        `UPDATE vinops.submittals
            SET status = $1,
                ball_in_court_organization_id = $2::uuid
          WHERE id = $3::uuid`,
        [targetStatus, bic, submittalId],
      );

      await this.outbox(transaction, {
        organizationId: submittal.organization_id,
        projectId,
        aggregateType: 'submittal',
        aggregateId: submittalId,
        eventType: 'submittal.reviewed.v1',
        payload: {
          submittal_id: submittalId,
          review_id: reviewId,
          stage: input.stage,
          decision: input.decision,
          new_status: targetStatus,
        },
      });

      const review = revRows[0]!;
      return {
        id: review.id,
        submittal_id: review.submittal_id,
        stage: review.stage,
        reviewer_user_id: review.reviewer_user_id,
        reviewer_partner_organization_id: review.reviewer_partner_organization_id,
        decision: review.decision,
        comments: review.comments,
        attached_file_id: review.attached_file_id,
        reviewed_at: review.reviewed_at.toISOString(),
      };
    });
  }

  // ====================== HELPER METHODS ======================

  private async getProjectCalendar(
    transaction: Transaction,
    projectId: string,
  ): Promise<ProjectCalendarConfig> {
    const rows = await transaction.query<{ working_days: number[]; holidays: string[] }>(
      `SELECT working_days, holidays FROM vinops.project_calendars
        WHERE project_id = $1::uuid AND status = 'Active' LIMIT 1`,
      [projectId],
    );
    if (rows[0]) {
      return {
        workingDays: rows[0].working_days,
        holidays: rows[0].holidays ?? [],
      };
    }
    return defaultProjectCalendar;
  }

  private async getProjectOrganizationId(
    transaction: Transaction,
    projectId: string,
  ): Promise<string> {
    const rows = await transaction.query<{ organization_id: string }>(
      `SELECT organization_id FROM vinops.projects WHERE id = $1::uuid`,
      [projectId],
    );
    if (!rows[0]) {
      throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
    }
    return rows[0].organization_id;
  }

  private async getUserPartnerOrganizationId(
    transaction: Transaction,
    projectId: string,
    userId: string,
  ): Promise<string | null> {
    const rows = await transaction.query<{ partner_organization_id: string | null }>(
      `SELECT partner_organization_id FROM vinops.project_members
        WHERE project_id = $1::uuid AND user_id = $2::uuid AND status = 'Active'`,
      [projectId, userId],
    );
    return rows[0]?.partner_organization_id ?? null;
  }

  private async requireProjectAccess(
    transaction: Transaction,
    projectId: string,
    userId: string,
  ): Promise<void> {
    const rows = await transaction.query<{ allowed: boolean }>(
      `SELECT vinops.can_access_project($1::uuid, $2::uuid) AS allowed`,
      [projectId, userId],
    );
    if (rows[0]?.allowed !== true) {
      throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
    }
  }

  private formatRfi(rfi: RfiRequestRow, responses: readonly RfiResponseRow[] = []): JsonRecord {
    const sla = rfi.due_at ? evaluateSlaStatus(rfi.due_at) : undefined;
    return {
      id: rfi.id,
      project_id: rfi.project_id,
      organization_id: rfi.organization_id,
      code: rfi.code,
      title: rfi.title,
      question: rfi.question,
      suggested_solution: rfi.suggested_solution,
      status: rfi.status,
      priority: rfi.priority,
      location_node_id: rfi.location_node_id,
      work_node_id: rfi.work_node_id,
      document_id: rfi.document_id,
      requesting_partner_organization_id: rfi.requesting_partner_organization_id,
      responding_partner_organization_id: rfi.responding_partner_organization_id,
      ball_in_court_organization_id: rfi.ball_in_court_organization_id,
      source_issue_id: rfi.source_issue_id,
      sla_business_days: rfi.sla_business_days,
      submitted_at: rfi.submitted_at?.toISOString() ?? null,
      due_at: rfi.due_at?.toISOString() ?? null,
      answered_at: rfi.answered_at?.toISOString() ?? null,
      closed_at: rfi.closed_at?.toISOString() ?? null,
      sla_status: sla?.status ?? 'ok',
      sla_hours_remaining: sla?.hoursRemaining ?? 0,
      version: rfi.version,
      created_by: rfi.created_by,
      created_at: rfi.created_at.toISOString(),
      updated_at: rfi.updated_at.toISOString(),
      responses: responses.map((resp) => ({
        id: resp.id,
        rfi_id: resp.rfi_id,
        response_type: resp.response_type,
        content: resp.content,
        author_user_id: resp.author_user_id,
        author_partner_organization_id: resp.author_partner_organization_id,
        revised_document_id: resp.revised_document_id,
        revised_document_revision_id: resp.revised_document_revision_id,
        file_id: resp.file_id,
        created_at: resp.created_at.toISOString(),
      })),
    };
  }

  private formatSubmittal(
    submittal: SubmittalRow,
    items: readonly SubmittalItemRow[] = [],
    reviews: readonly SubmittalReviewRow[] = [],
  ): JsonRecord {
    const sla = submittal.due_at ? evaluateSlaStatus(submittal.due_at) : undefined;
    return {
      id: submittal.id,
      project_id: submittal.project_id,
      organization_id: submittal.organization_id,
      code: submittal.code,
      title: submittal.title,
      submittal_type: submittal.submittal_type,
      status: submittal.status,
      maker_partner_organization_id: submittal.maker_partner_organization_id,
      lead_contractor_partner_organization_id: submittal.lead_contractor_partner_organization_id,
      consultant_partner_organization_id: submittal.consultant_partner_organization_id,
      ball_in_court_organization_id: submittal.ball_in_court_organization_id,
      location_node_id: submittal.location_node_id,
      work_node_id: submittal.work_node_id,
      specification_document_id: submittal.specification_document_id,
      drawing_document_id: submittal.drawing_document_id,
      submitted_at: submittal.submitted_at?.toISOString() ?? null,
      due_at: submittal.due_at?.toISOString() ?? null,
      sla_business_days: submittal.sla_business_days,
      sla_status: sla?.status ?? 'ok',
      version: submittal.version,
      created_by: submittal.created_by,
      created_at: submittal.created_at.toISOString(),
      updated_at: submittal.updated_at.toISOString(),
      items: items.map((it) => ({
        id: it.id,
        submittal_id: it.submittal_id,
        item_number: it.item_number,
        description: it.description,
        manufacturer: it.manufacturer,
        model_or_grade: it.model_or_grade,
        sample_quantity: it.sample_quantity,
        physical_sample_received: it.physical_sample_received,
        document_id: it.document_id,
        file_id: it.file_id,
        created_at: it.created_at.toISOString(),
      })),
      reviews: reviews.map((rev) => ({
        id: rev.id,
        submittal_id: rev.submittal_id,
        stage: rev.stage,
        reviewer_user_id: rev.reviewer_user_id,
        reviewer_partner_organization_id: rev.reviewer_partner_organization_id,
        decision: rev.decision,
        comments: rev.comments,
        attached_file_id: rev.attached_file_id,
        reviewed_at: rev.reviewed_at.toISOString(),
      })),
    };
  }

  private async transaction<T>(
    identity: RequestIdentity,
    correlationId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    if (this.database === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      operation,
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
