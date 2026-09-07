import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import {
  addWorkingDays,
  assertIssueMutable,
  assertValidSeverity,
  defaultProjectCalendar,
  issueTransitionTarget,
  suggestContractor,
  validateGpsCoordinates,
  type ContractorCandidate,
  type GpsCoordinates,
  type IssueAction,
  type IssueStatus,
  type ProjectCalendarConfig,
} from '@vinops/domain';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';

type JsonRecord = Record<string, unknown>;

export type QuickCreateIssueInput = {
  code: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  locationNodeId?: string | undefined;
  workNodeId?: string | undefined;
  contractorOrganizationId?: string | undefined;
  suggestedContractorOrganizationId?: string | undefined;
  assignedToUserId?: string | undefined;
  gps?: GpsCoordinates | undefined;
  dueAt?: string | undefined;
  attachmentFileIds?: readonly string[] | undefined;
};

export type IssueTransitionInput = {
  action: IssueAction;
  assignedToUserId?: string | undefined;
  contractorOrganizationId?: string | undefined;
  comment?: string | undefined;
};

export type EscalateToRfiInput = {
  rfiCode: string;
  title: string;
  question: string;
  suggestedSolution?: string | undefined;
  priority?: string | undefined;
  requestingPartnerOrganizationId: string;
  respondingPartnerOrganizationId?: string | undefined;
  slaBusinessDays?: number | undefined;
};

type FieldIssueRow = {
  id: string;
  organization_id: string;
  project_id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  severity: string;
  status: string;
  location_node_id: string | null;
  work_node_id: string | null;
  contractor_organization_id: string | null;
  suggested_contractor_organization_id: string | null;
  assigned_to_user_id: string | null;
  gps_latitude: string | null;
  gps_longitude: string | null;
  gps_accuracy_meters: string | null;
  due_at: Date | null;
  resolved_at: Date | null;
  closed_at: Date | null;
  escalated_to_rfi_id: string | null;
  version: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type IssueAttachmentRow = {
  id: string;
  issue_id: string;
  file_id: string;
  attachment_type: string;
  caption: string | null;
  created_at: Date;
};

type IssueCommentRow = {
  id: string;
  issue_id: string;
  author_user_id: string;
  content: string;
  created_at: Date;
};

@Injectable()
export class IssueService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(@Inject(API_CONFIG) config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-issues-api',
            runtimeRole: 'vinops_app',
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  async quickCreateIssue(
    identity: RequestIdentity,
    projectId: string,
    input: QuickCreateIssueInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    assertValidSeverity(input.severity);
    if (input.gps) {
      validateGpsCoordinates(input.gps);
    }

    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);

      // Resolve or suggest contractor
      let suggestedContractorId = input.suggestedContractorOrganizationId;
      let finalContractorId = input.contractorOrganizationId;

      if (!finalContractorId || !suggestedContractorId) {
        const candidates = await this.getContractorCandidates(transaction, projectId);
        let workOwnerId: string | null = null;
        if (input.workNodeId) {
          const workNode = await transaction.query<{
            owner_partner_organization_id: string | null;
          }>(`SELECT owner_partner_organization_id FROM vinops.work_nodes WHERE id = $1::uuid`, [
            input.workNodeId,
          ]);
          workOwnerId = workNode[0]?.owner_partner_organization_id ?? null;
        }
        const suggested = suggestContractor(candidates, {
          workNodeOwnerPartnerOrganizationId: workOwnerId,
          category: input.category,
        });
        if (suggested) {
          suggestedContractorId = suggestedContractorId ?? suggested.partnerOrganizationId;
          finalContractorId = finalContractorId ?? suggested.partnerOrganizationId;
        }
      }

      const issueId = randomUUID();
      const rows = await transaction.query<FieldIssueRow>(
        `INSERT INTO vinops.field_issues (
          id, organization_id, project_id, code, title, description, category,
          severity, status, location_node_id, work_node_id, contractor_organization_id,
          suggested_contractor_organization_id, assigned_to_user_id,
          gps_latitude, gps_longitude, gps_accuracy_meters, due_at, created_by
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
          $8, 'Open', $9::uuid, $10::uuid, $11::uuid,
          $12::uuid, $13::uuid,
          $14, $15, $16, $17, $18::uuid
        ) RETURNING *`,
        [
          issueId,
          orgId,
          projectId,
          input.code.trim(),
          input.title.trim(),
          input.description.trim(),
          input.category.trim(),
          input.severity,
          input.locationNodeId ?? null,
          input.workNodeId ?? null,
          finalContractorId ?? null,
          suggestedContractorId ?? null,
          input.assignedToUserId ?? null,
          input.gps?.latitude ?? null,
          input.gps?.longitude ?? null,
          input.gps?.accuracyMeters ?? null,
          input.dueAt ? new Date(input.dueAt) : null,
          identity.userId,
        ],
      );
      const created = rows[0];
      if (!created) {
        throw new PlatformError('CREATE_FAILED', 'errors.internal', 500);
      }

      // Attach photos if provided
      const attachments: IssueAttachmentRow[] = [];
      if (input.attachmentFileIds && input.attachmentFileIds.length > 0) {
        for (const fileId of input.attachmentFileIds) {
          const attRows = await transaction.query<IssueAttachmentRow>(
            `INSERT INTO vinops.issue_attachments (
              id, organization_id, project_id, issue_id, file_id, attachment_type, created_by
            ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'site_photo', $6::uuid)
            RETURNING *`,
            [randomUUID(), orgId, projectId, issueId, fileId, identity.userId],
          );
          if (attRows[0]) attachments.push(attRows[0]);
        }
      }

      await this.outbox(transaction, {
        organizationId: orgId,
        projectId,
        aggregateType: 'field_issue',
        aggregateId: issueId,
        eventType: 'issue.created.v1',
        payload: {
          issue_id: issueId,
          code: created.code,
          status: 'Open',
          severity: created.severity,
        },
      });

      return this.formatIssue(created, attachments, []);
    });
  }

  async listIssues(
    identity: RequestIdentity,
    projectId: string,
    filters: {
      status?: string | undefined;
      severity?: string | undefined;
      locationNodeId?: string | undefined;
      workNodeId?: string | undefined;
      contractorOrganizationId?: string | undefined;
    },
    correlationId: string,
  ): Promise<readonly JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      await this.requireProjectAccess(transaction, projectId, identity.userId);

      const conditions: string[] = ['project_id = $1::uuid'];
      const params: unknown[] = [projectId];
      let pIdx = 2;

      if (filters.status) {
        conditions.push(`status = $${pIdx++}`);
        params.push(filters.status);
      }
      if (filters.severity) {
        conditions.push(`severity = $${pIdx++}`);
        params.push(filters.severity);
      }
      if (filters.locationNodeId) {
        conditions.push(`location_node_id = $${pIdx++}::uuid`);
        params.push(filters.locationNodeId);
      }
      if (filters.workNodeId) {
        conditions.push(`work_node_id = $${pIdx++}::uuid`);
        params.push(filters.workNodeId);
      }
      if (filters.contractorOrganizationId) {
        conditions.push(`contractor_organization_id = $${pIdx}::uuid`);
        params.push(filters.contractorOrganizationId);
      }

      const rows = await transaction.query<FieldIssueRow>(
        `SELECT * FROM vinops.field_issues WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 200`,
        params,
      );

      const result: JsonRecord[] = [];
      for (const issue of rows) {
        result.push(this.formatIssue(issue));
      }
      return result;
    });
  }

  async getIssue(
    identity: RequestIdentity,
    projectId: string,
    issueId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      await this.requireProjectAccess(transaction, projectId, identity.userId);
      const rows = await transaction.query<FieldIssueRow>(
        `SELECT * FROM vinops.field_issues WHERE id = $1::uuid AND project_id = $2::uuid`,
        [issueId, projectId],
      );
      const issue = rows[0];
      if (!issue) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const attachments = await transaction.query<IssueAttachmentRow>(
        `SELECT * FROM vinops.issue_attachments WHERE issue_id = $1::uuid ORDER BY created_at ASC`,
        [issueId],
      );
      const comments = await transaction.query<IssueCommentRow>(
        `SELECT * FROM vinops.issue_comments WHERE issue_id = $1::uuid ORDER BY created_at ASC`,
        [issueId],
      );

      return this.formatIssue(issue, attachments, comments);
    });
  }

  async transitionIssue(
    identity: RequestIdentity,
    projectId: string,
    issueId: string,
    input: IssueTransitionInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<FieldIssueRow>(
        `SELECT * FROM vinops.field_issues WHERE id = $1::uuid AND project_id = $2::uuid FOR UPDATE`,
        [issueId, projectId],
      );
      const issue = rows[0];
      if (!issue) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const targetStatus = issueTransitionTarget(issue.status as IssueStatus, input.action);

      const resolvedAt = targetStatus === 'Resolved' ? new Date() : issue.resolved_at;
      const closedAt = targetStatus === 'Closed' ? new Date() : issue.closed_at;

      const updated = await transaction.query<FieldIssueRow>(
        `UPDATE vinops.field_issues
            SET status = $1,
                assigned_to_user_id = COALESCE($2::uuid, assigned_to_user_id),
                contractor_organization_id = COALESCE($3::uuid, contractor_organization_id),
                resolved_at = $4,
                closed_at = $5
          WHERE id = $6::uuid
          RETURNING *`,
        [
          targetStatus,
          input.assignedToUserId ?? null,
          input.contractorOrganizationId ?? null,
          resolvedAt,
          closedAt,
          issueId,
        ],
      );

      if (input.comment && input.comment.trim().length > 0) {
        await transaction.execute(
          `INSERT INTO vinops.issue_comments (id, organization_id, project_id, issue_id, author_user_id, content)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6)`,
          [
            randomUUID(),
            issue.organization_id,
            projectId,
            issueId,
            identity.userId,
            input.comment.trim(),
          ],
        );
      }

      await this.outbox(transaction, {
        organizationId: issue.organization_id,
        projectId,
        aggregateType: 'field_issue',
        aggregateId: issueId,
        eventType: 'issue.transitioned.v1',
        payload: { issue_id: issueId, from: issue.status, to: targetStatus, action: input.action },
      });

      return this.formatIssue(updated[0]!);
    });
  }

  async addComment(
    identity: RequestIdentity,
    projectId: string,
    issueId: string,
    content: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    if (!content || content.trim().length === 0) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422);
    }
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<FieldIssueRow>(
        `SELECT organization_id FROM vinops.field_issues WHERE id = $1::uuid AND project_id = $2::uuid`,
        [issueId, projectId],
      );
      const issue = rows[0];
      if (!issue) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }

      const commentId = randomUUID();
      const commentRows = await transaction.query<IssueCommentRow>(
        `INSERT INTO vinops.issue_comments (id, organization_id, project_id, issue_id, author_user_id, content)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6)
         RETURNING *`,
        [commentId, issue.organization_id, projectId, issueId, identity.userId, content.trim()],
      );

      const comment = commentRows[0]!;
      return {
        id: comment.id,
        issue_id: comment.issue_id,
        author_user_id: comment.author_user_id,
        content: comment.content,
        created_at: comment.created_at.toISOString(),
      };
    });
  }

  async escalateToRfi(
    identity: RequestIdentity,
    projectId: string,
    issueId: string,
    input: EscalateToRfiInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<FieldIssueRow>(
        `SELECT * FROM vinops.field_issues WHERE id = $1::uuid AND project_id = $2::uuid FOR UPDATE`,
        [issueId, projectId],
      );
      const issue = rows[0];
      if (!issue) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404);
      }
      assertIssueMutable(issue.status as IssueStatus);

      if (issue.escalated_to_rfi_id) {
        throw new PlatformError('ALREADY_ESCALATED', 'errors.conflict', 409);
      }

      // Calculate SLA deadline
      const calendar = await this.getProjectCalendar(transaction, projectId);
      const slaDays = input.slaBusinessDays ?? 5;
      const submittedAt = new Date();
      const dueAt = addWorkingDays(submittedAt, slaDays, calendar);

      const rfiId = randomUUID();
      await transaction.execute(
        `INSERT INTO vinops.rfi_requests (
          id, organization_id, project_id, code, title, question, suggested_solution,
          status, priority, location_node_id, work_node_id, requesting_partner_organization_id,
          responding_partner_organization_id, ball_in_court_organization_id, source_issue_id,
          submitted_at, due_at, sla_business_days, created_by
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7,
          'Submitted', $8, $9::uuid, $10::uuid, $11::uuid,
          $12::uuid, $13::uuid, $14::uuid,
          $15, $16, $17, $18::uuid
        )`,
        [
          rfiId,
          issue.organization_id,
          projectId,
          input.rfiCode.trim(),
          input.title.trim(),
          input.question.trim(),
          input.suggestedSolution?.trim() ?? null,
          input.priority ?? 'normal',
          issue.location_node_id,
          issue.work_node_id,
          input.requestingPartnerOrganizationId,
          input.respondingPartnerOrganizationId ?? null,
          input.respondingPartnerOrganizationId ?? null,
          issueId,
          submittedAt,
          dueAt,
          slaDays,
          identity.userId,
        ],
      );

      // Link RFI to issue
      await transaction.execute(
        `UPDATE vinops.field_issues SET escalated_to_rfi_id = $1::uuid WHERE id = $2::uuid`,
        [rfiId, issueId],
      );

      await this.outbox(transaction, {
        organizationId: issue.organization_id,
        projectId,
        aggregateType: 'rfi_request',
        aggregateId: rfiId,
        eventType: 'issue.escalated_to_rfi.v1',
        payload: { issue_id: issueId, rfi_id: rfiId, rfi_code: input.rfiCode },
      });

      const rfiRow = await transaction.query<{
        id: string;
        project_id: string;
        organization_id: string;
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
        sla_business_days: number;
        submitted_at: Date | null;
        due_at: Date | null;
        answered_at: Date | null;
        closed_at: Date | null;
        version: string;
        created_by: string;
        created_at: Date;
        updated_at: Date;
      }>(`SELECT * FROM vinops.rfi_requests WHERE id = $1::uuid`, [rfiId]);

      const rfi = rfiRow[0]!;
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
        version: rfi.version,
        created_by: rfi.created_by,
        created_at: rfi.created_at.toISOString(),
        updated_at: rfi.updated_at.toISOString(),
        responses: [],
      };
    });
  }

  private async getContractorCandidates(
    transaction: Transaction,
    projectId: string,
  ): Promise<ContractorCandidate[]> {
    const rows = await transaction.query<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM vinops.partner_organizations
        WHERE project_id = $1::uuid AND status = 'Active'`,
      [projectId],
    );
    return rows.map((r) => ({
      partnerOrganizationId: r.id,
      code: r.code,
      name: r.name,
    }));
  }

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

  private formatIssue(
    issue: FieldIssueRow,
    attachments: readonly IssueAttachmentRow[] = [],
    comments: readonly IssueCommentRow[] = [],
  ): JsonRecord {
    return {
      id: issue.id,
      project_id: issue.project_id,
      organization_id: issue.organization_id,
      code: issue.code,
      title: issue.title,
      description: issue.description,
      category: issue.category,
      severity: issue.severity,
      status: issue.status,
      location_node_id: issue.location_node_id,
      work_node_id: issue.work_node_id,
      contractor_organization_id: issue.contractor_organization_id,
      suggested_contractor_organization_id: issue.suggested_contractor_organization_id,
      assigned_to_user_id: issue.assigned_to_user_id,
      gps_latitude: issue.gps_latitude !== null ? Number(issue.gps_latitude) : null,
      gps_longitude: issue.gps_longitude !== null ? Number(issue.gps_longitude) : null,
      gps_accuracy_meters:
        issue.gps_accuracy_meters !== null ? Number(issue.gps_accuracy_meters) : null,
      due_at: issue.due_at?.toISOString() ?? null,
      resolved_at: issue.resolved_at?.toISOString() ?? null,
      closed_at: issue.closed_at?.toISOString() ?? null,
      escalated_to_rfi_id: issue.escalated_to_rfi_id,
      version: issue.version,
      created_by: issue.created_by,
      created_at: issue.created_at.toISOString(),
      updated_at: issue.updated_at.toISOString(),
      attachments: attachments.map((a) => ({
        id: a.id,
        issue_id: a.issue_id,
        file_id: a.file_id,
        attachment_type: a.attachment_type,
        caption: a.caption,
        created_at: a.created_at.toISOString(),
      })),
      comments: comments.map((c) => ({
        id: c.id,
        issue_id: c.issue_id,
        author_user_id: c.author_user_id,
        content: c.content,
        created_at: c.created_at.toISOString(),
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
