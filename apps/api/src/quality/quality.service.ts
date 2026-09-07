import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import {
  assertAcceptanceSignSequence,
  assertCarIndependence,
  assertInspectionChecklistResult,
  type AcceptanceRecordType,
  type AcceptanceResult,
  type AcceptanceStatus,
  type ChecklistResultType,
  type FindingSeverity,
  type FindingStatus,
} from '@vinops/domain';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';

@Injectable()
export class QualityService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-quality-api',
            runtimeRole: 'vinops_app',
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  private requireDatabase(): VinopsDatabase {
    if (this.database === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.database;
  }

  // --- Inspection Templates ---
  async createTemplate(
    identity: RequestIdentity,
    projectId: string,
    input: {
      code: string;
      name: string;
      category?: string;
      checklist_items?: Array<{
        item_key: string;
        title: string;
        description?: string;
        sequence?: number;
        is_mandatory?: boolean;
        requires_evidence?: boolean;
        criterion_type?: 'pass_fail' | 'measurement' | 'text';
        unit?: string;
        min_value?: number;
        max_value?: number;
      }>;
    },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const templateId = randomUUID();
        const projectRes = await tx.query<{ organization_id: string }>(
          'SELECT organization_id FROM vinops.projects WHERE id = $1',
          [projectId],
        );
        if (projectRes.length === 0) {
          throw new PlatformError('PROJECT_NOT_FOUND', 'errors.projectNotFound', 404, false);
        }
        const organizationId = projectRes[0]!.organization_id;

        await tx.query(
          `INSERT INTO vinops.inspection_templates (id, organization_id, project_id, code, name, category, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            templateId,
            organizationId,
            projectId,
            input.code,
            input.name,
            input.category ?? 'general',
            identity.userId,
          ],
        );

        if (input.checklist_items && input.checklist_items.length > 0) {
          for (const item of input.checklist_items) {
            await tx.query(
              `INSERT INTO vinops.checklist_items (
                id, template_id, item_key, title, description, sequence, is_mandatory, requires_evidence, criterion_type, unit, min_value, max_value
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
              [
                randomUUID(),
                templateId,
                item.item_key,
                item.title,
                item.description ?? '',
                item.sequence ?? 1,
                item.is_mandatory ?? true,
                item.requires_evidence ?? false,
                item.criterion_type ?? 'pass_fail',
                item.unit ?? null,
                item.min_value ?? null,
                item.max_value ?? null,
              ],
            );
          }
        }

        return this.getTemplateById(tx, templateId);
      },
    );
  }

  async listTemplates(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<{ items: readonly unknown[]; page: { next_cursor: null; has_more: false } }> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const res = await tx.query(
          `SELECT t.*,
                  COALESCE(json_agg(c ORDER BY c.sequence) FILTER (WHERE c.id IS NOT NULL), '[]') AS items
             FROM vinops.inspection_templates t
        LEFT JOIN vinops.checklist_items c ON c.template_id = t.id
            WHERE t.project_id = $1
         GROUP BY t.id
         ORDER BY t.created_at DESC`,
          [projectId],
        );
        return { items: res, page: { next_cursor: null, has_more: false } };
      },
    );
  }

  private async getTemplateById(tx: Transaction, templateId: string): Promise<unknown> {
    const res = await tx.query(
      `SELECT t.*,
              COALESCE(json_agg(c ORDER BY c.sequence) FILTER (WHERE c.id IS NOT NULL), '[]') AS items
         FROM vinops.inspection_templates t
    LEFT JOIN vinops.checklist_items c ON c.template_id = t.id
        WHERE t.id = $1
     GROUP BY t.id`,
      [templateId],
    );
    return res[0] ?? null;
  }

  // --- Inspections ---
  async createInspection(
    identity: RequestIdentity,
    projectId: string,
    input: {
      code: string;
      title: string;
      template_id?: string;
      location_id?: string;
      work_item_id?: string;
      inspection_date?: string;
      notes?: string;
    },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const projectRes = await tx.query<{ organization_id: string }>(
          'SELECT organization_id FROM vinops.projects WHERE id = $1',
          [projectId],
        );
        if (projectRes.length === 0) {
          throw new PlatformError('PROJECT_NOT_FOUND', 'errors.projectNotFound', 404, false);
        }
        const organizationId = projectRes[0]!.organization_id;
        const inspectionId = randomUUID();

        await tx.query(
          `INSERT INTO vinops.inspections (
            id, organization_id, project_id, template_id, code, title, inspector_id, location_id, work_item_id, inspection_date, notes, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            inspectionId,
            organizationId,
            projectId,
            input.template_id ?? null,
            input.code ?? `BB-${randomUUID().slice(0, 8).toUpperCase()}`,
            input.title,
            identity.userId,
            input.location_id ?? null,
            input.work_item_id ?? null,
            input.inspection_date ?? new Date().toISOString().slice(0, 10),
            input.notes ?? '',
            identity.userId,
          ],
        );

        return this.getInspectionById(tx, inspectionId);
      },
    );
  }

  async getInspection(
    identity: RequestIdentity,
    inspectionId: string,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => this.getInspectionById(tx, inspectionId),
    );
  }

  async listInspections(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<{ items: readonly unknown[]; page: { next_cursor: null; has_more: false } }> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const res = await tx.query(
          `SELECT i.*,
                  COALESCE((SELECT json_agg(r) FROM vinops.inspection_results r WHERE r.inspection_id = i.id), '[]') AS results,
                  COALESCE((SELECT json_agg(f) FROM vinops.inspection_findings f WHERE f.inspection_id = i.id), '[]') AS findings
             FROM vinops.inspections i
            WHERE i.project_id = $1
            ORDER BY i.created_at DESC`,
          [projectId],
        );
        return { items: res, page: { next_cursor: null, has_more: false } };
      },
    );
  }

  private async getInspectionById(tx: Transaction, inspectionId: string): Promise<unknown> {
    const res = await tx.query(
      `SELECT i.*,
              COALESCE((SELECT json_agg(r) FROM vinops.inspection_results r WHERE r.inspection_id = i.id), '[]') AS results,
              COALESCE((SELECT json_agg(f) FROM vinops.inspection_findings f WHERE f.inspection_id = i.id), '[]') AS findings
         FROM vinops.inspections i
        WHERE i.id = $1`,
      [inspectionId],
    );
    if (res.length === 0) {
      throw new PlatformError('INSPECTION_NOT_FOUND', 'errors.notFound', 404, false);
    }
    return res[0];
  }

  async saveResult(
    identity: RequestIdentity,
    inspectionId: string,
    itemKey: string,
    input: {
      result: ChecklistResultType;
      value_decimal?: number;
      unit?: string;
      notes?: string;
      evidence_file_ids?: string[];
    },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        assertInspectionChecklistResult({
          result: input.result,
          requiresEvidence: false,
          evidenceFileIds: input.evidence_file_ids ?? [],
          isMandatory: false,
        });

        await tx.query(
          `INSERT INTO vinops.inspection_results (
            id, inspection_id, item_key, result, value_decimal, unit, notes, evidence_file_ids, recorded_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (inspection_id, item_key) DO UPDATE
            SET result = EXCLUDED.result,
                value_decimal = EXCLUDED.value_decimal,
                unit = EXCLUDED.unit,
                notes = EXCLUDED.notes,
                evidence_file_ids = EXCLUDED.evidence_file_ids,
                recorded_by = EXCLUDED.recorded_by,
                recorded_at = now()`,
          [
            randomUUID(),
            inspectionId,
            itemKey,
            input.result,
            input.value_decimal ?? null,
            input.unit ?? null,
            input.notes ?? '',
            input.evidence_file_ids ?? [],
            identity.userId,
          ],
        );

        const res = await tx.query(
          'SELECT * FROM vinops.inspection_results WHERE inspection_id = $1 AND item_key = $2',
          [inspectionId, itemKey],
        );
        return res[0];
      },
    );
  }

  // --- Findings & CAR ---
  async createFinding(
    identity: RequestIdentity,
    inspectionId: string,
    input: {
      code: string;
      description: string;
      severity?: FindingSeverity;
      location_detail?: string;
      owner_id?: string;
      due_at?: string;
    },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const insp = await tx.query<{ organization_id: string; project_id: string }>(
          'SELECT organization_id, project_id FROM vinops.inspections WHERE id = $1',
          [inspectionId],
        );
        if (insp.length === 0) {
          throw new PlatformError('INSPECTION_NOT_FOUND', 'errors.notFound', 404, false);
        }
        const { organization_id, project_id } = insp[0]!;
        const findingId = randomUUID();

        await tx.query(
          `INSERT INTO vinops.inspection_findings (
            id, organization_id, project_id, inspection_id, code, severity, description, location_detail, owner_id, due_at, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            findingId,
            organization_id,
            project_id,
            inspectionId,
            input.code ?? `FND-${randomUUID().slice(0, 8).toUpperCase()}`,
            input.severity ?? 'Medium',
            input.description,
            input.location_detail ?? '',
            input.owner_id ?? identity.userId,
            input.due_at ?? null,
            identity.userId,
          ],
        );

        const res = await tx.query('SELECT * FROM vinops.inspection_findings WHERE id = $1', [
          findingId,
        ]);
        return res[0];
      },
    );
  }

  async submitCorrection(
    identity: RequestIdentity,
    findingId: string,
    input: { description: string; evidence_file_ids?: string[] },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const findingRes = await tx.query<{ id: string }>(
          'SELECT id FROM vinops.inspection_findings WHERE id = $1',
          [findingId],
        );
        if (findingRes.length === 0) {
          throw new PlatformError('FINDING_NOT_FOUND', 'errors.notFound', 404, false);
        }

        const carId = randomUUID();
        await tx.query(
          `INSERT INTO vinops.corrective_actions (
            id, finding_id, description, performer_id, status, evidence_file_ids
          ) VALUES ($1, $2, $3, $4, 'Submitted', $5)`,
          [carId, findingId, input.description, identity.userId, input.evidence_file_ids ?? []],
        );

        await tx.query(
          `UPDATE vinops.inspection_findings SET status = 'Pending Verification', updated_at = now() WHERE id = $1`,
          [findingId],
        );

        const res = await tx.query('SELECT * FROM vinops.corrective_actions WHERE id = $1', [
          carId,
        ]);
        return res[0];
      },
    );
  }

  async transitionFinding(
    identity: RequestIdentity,
    findingId: string,
    input: { action: 'verify' | 'reject' | 'waive' | 'close'; reason?: string },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const findingRes = await tx.query<{
          severity: FindingSeverity;
          status: FindingStatus;
        }>('SELECT severity, status FROM vinops.inspection_findings WHERE id = $1', [findingId]);
        if (findingRes.length === 0) {
          throw new PlatformError('FINDING_NOT_FOUND', 'errors.notFound', 404, false);
        }
        const { severity } = findingRes[0]!;

        if (input.action === 'verify' || input.action === 'close') {
          const carRes = await tx.query<{ performer_id: string }>(
            'SELECT performer_id FROM vinops.corrective_actions WHERE finding_id = $1 ORDER BY attempt_no DESC LIMIT 1',
            [findingId],
          );
          if (carRes.length > 0) {
            const performerId = carRes[0]!.performer_id;
            assertCarIndependence(performerId, identity.userId, severity);
          }
        }

        const nextStatus: FindingStatus =
          input.action === 'verify'
            ? 'Resolved'
            : input.action === 'close'
              ? 'Closed'
              : input.action === 'waive'
                ? 'Waived'
                : 'Open';

        await tx.query(
          'UPDATE vinops.inspection_findings SET status = $1, updated_at = now() WHERE id = $2',
          [nextStatus, findingId],
        );

        const res = await tx.query('SELECT * FROM vinops.inspection_findings WHERE id = $1', [
          findingId,
        ]);
        return res[0];
      },
    );
  }

  // --- 3-Party Acceptance Records ---
  async createAcceptanceRecord(
    identity: RequestIdentity,
    projectId: string,
    input: {
      code: string;
      inspection_id?: string;
      record_type?: AcceptanceRecordType;
      legal_basis?: string;
      result?: AcceptanceResult;
      conditions_notes?: string;
    },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const projectRes = await tx.query<{ organization_id: string }>(
          'SELECT organization_id FROM vinops.projects WHERE id = $1',
          [projectId],
        );
        if (projectRes.length === 0) {
          throw new PlatformError('PROJECT_NOT_FOUND', 'errors.projectNotFound', 404, false);
        }
        const organizationId = projectRes[0]!.organization_id;
        const recordId = randomUUID();

        await tx.query(
          `INSERT INTO vinops.acceptance_records (
            id, organization_id, project_id, inspection_id, code, record_type, legal_basis, result, status, conditions_notes, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Draft', $9, $10)`,
          [
            recordId,
            organizationId,
            projectId,
            input.inspection_id ?? null,
            input.code,
            input.record_type ?? 'work_acceptance',
            input.legal_basis ?? 'Nghị định 207/2026/NĐ-CP & Thông tư 32/2026/TT-BXD',
            input.result ?? 'Accepted',
            input.conditions_notes ?? '',
            identity.userId,
          ],
        );

        const res = await tx.query('SELECT * FROM vinops.acceptance_records WHERE id = $1', [
          recordId,
        ]);
        return res[0];
      },
    );
  }

  async getAcceptanceRecord(
    identity: RequestIdentity,
    recordId: string,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const res = await tx.query('SELECT * FROM vinops.acceptance_records WHERE id = $1', [
          recordId,
        ]);
        if (res.length === 0) {
          throw new PlatformError('ACCEPTANCE_RECORD_NOT_FOUND', 'errors.notFound', 404, false);
        }
        return res[0];
      },
    );
  }

  async listAcceptanceRecords(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<{ items: readonly unknown[]; page: { next_cursor: null; has_more: false } }> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const res = await tx.query(
          'SELECT * FROM vinops.acceptance_records WHERE project_id = $1 ORDER BY created_at DESC',
          [projectId],
        );
        return { items: res, page: { next_cursor: null, has_more: false } };
      },
    );
  }

  async signAcceptanceContractor(
    identity: RequestIdentity,
    recordId: string,
    signatureData: string,
    correlationId: string,
  ): Promise<unknown> {
    return this.signAcceptance(identity, recordId, 'contractor', signatureData, correlationId);
  }

  async signAcceptanceSupervisor(
    identity: RequestIdentity,
    recordId: string,
    signatureData: string,
    correlationId: string,
  ): Promise<unknown> {
    return this.signAcceptance(identity, recordId, 'supervisor', signatureData, correlationId);
  }

  async signAcceptancePmu(
    identity: RequestIdentity,
    recordId: string,
    signatureData: string,
    correlationId: string,
  ): Promise<unknown> {
    return this.signAcceptance(identity, recordId, 'pmu', signatureData, correlationId);
  }

  private async signAcceptance(
    identity: RequestIdentity,
    recordId: string,
    role: 'contractor' | 'supervisor' | 'pmu',
    signatureData: string,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (tx: Transaction) => {
        const currentRes = await tx.query<{ status: AcceptanceStatus }>(
          'SELECT status FROM vinops.acceptance_records WHERE id = $1 FOR UPDATE',
          [recordId],
        );
        if (currentRes.length === 0) {
          throw new PlatformError('ACCEPTANCE_RECORD_NOT_FOUND', 'errors.notFound', 404, false);
        }
        const currentStatus = currentRes[0]!.status;

        const nextStatus = assertAcceptanceSignSequence(currentStatus, role);

        let updateSql: string;
        if (role === 'contractor') {
          updateSql = `
            UPDATE vinops.acceptance_records
               SET status = $2,
                   contractor_signed_by = $3,
                   contractor_signed_at = now(),
                   contractor_signature_data = $4,
                   version = version + 1,
                   updated_at = now()
             WHERE id = $1`;
        } else if (role === 'supervisor') {
          updateSql = `
            UPDATE vinops.acceptance_records
               SET status = $2,
                   supervisor_signed_by = $3,
                   supervisor_signed_at = now(),
                   supervisor_signature_data = $4,
                   version = version + 1,
                   updated_at = now()
             WHERE id = $1`;
        } else {
          updateSql = `
            UPDATE vinops.acceptance_records
               SET status = $2,
                   pmu_signed_by = $3,
                   pmu_signed_at = now(),
                   pmu_signature_data = $4,
                   version = version + 1,
                   updated_at = now()
             WHERE id = $1`;
        }

        await tx.query(updateSql, [recordId, nextStatus, identity.userId, signatureData]);

        const res = await tx.query('SELECT * FROM vinops.acceptance_records WHERE id = $1', [
          recordId,
        ]);
        return res[0];
      },
    );
  }
}
