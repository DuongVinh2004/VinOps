import type { Logger } from 'pino';
import { evaluateSlaStatus, type SlaStatusResult } from '@vinops/domain';
import type { VinopsDatabase } from '@vinops/database';
import type { EscalationNotifier, SlaBreachNotice } from './escalation-notifier.js';

export type ActiveSlaCandidate = {
  id: string;
  organization_id: string;
  project_id: string;
  reference_number: string;
  title: string;
  due_date: string | Date;
  status: string;
  ball_in_court_organization_id: string | null;
};

export interface SlaMonitorStore {
  getActiveRfis(): Promise<readonly ActiveSlaCandidate[]>;
  getActiveSubmittals(): Promise<readonly ActiveSlaCandidate[]>;
}

export class PostgresSlaMonitorStore implements SlaMonitorStore {
  constructor(
    private readonly database: VinopsDatabase,
    private readonly systemUserId: string = '00000000-0000-0000-0000-000000000000',
  ) {}

  async getActiveRfis(): Promise<readonly ActiveSlaCandidate[]> {
    return this.database.withTransaction({ actorUserId: this.systemUserId }, async (client) => {
      return client.query<ActiveSlaCandidate>(
        `SELECT id, organization_id, project_id, code AS reference_number, title, due_at AS due_date, status, ball_in_court_organization_id
           FROM vinops.rfi_requests
          WHERE due_at IS NOT NULL
            AND status NOT IN ('Official Answered', 'Closed')`,
      );
    });
  }

  async getActiveSubmittals(): Promise<readonly ActiveSlaCandidate[]> {
    return this.database.withTransaction({ actorUserId: this.systemUserId }, async (client) => {
      return client.query<ActiveSlaCandidate>(
        `SELECT id, organization_id, project_id, code AS reference_number, title, due_at AS due_date, status, ball_in_court_organization_id
           FROM vinops.submittals
          WHERE due_at IS NOT NULL
            AND status NOT IN ('Approved', 'Approved as Noted', 'Rejected')`,
      );
    });
  }
}

export type SlaMonitorReport = {
  checkedRfis: number;
  checkedSubmittals: number;
  warnings48h: number;
  warnings24h: number;
  breaches: number;
  notices: readonly SlaBreachNotice[];
};

export class SlaMonitorWorker {
  constructor(
    private readonly store: SlaMonitorStore,
    private readonly notifier: EscalationNotifier,
    private readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async runOnce(): Promise<SlaMonitorReport> {
    const now = this.clock();
    const notices: SlaBreachNotice[] = [];
    let warnings48h = 0;
    let warnings24h = 0;
    let breaches = 0;

    const rfis = await this.store.getActiveRfis();
    for (const rfi of rfis) {
      const dueDate = new Date(rfi.due_date);
      const sla: SlaStatusResult = evaluateSlaStatus(dueDate, now);

      if (sla.status !== 'ok') {
        if (sla.status === 'warning_48h') warnings48h += 1;
        else if (sla.status === 'warning_24h') warnings24h += 1;
        else if (sla.status === 'breached') breaches += 1;

        const notice = await this.notifier.notify({
          aggregateType: 'rfi',
          aggregateId: rfi.id,
          referenceNumber: rfi.reference_number,
          title: rfi.title,
          organizationId: rfi.organization_id,
          projectId: rfi.project_id,
          dueDate: dueDate.toISOString(),
          hoursRemaining: sla.hoursRemaining,
          status: sla.status,
          ballInCourtOrgId: rfi.ball_in_court_organization_id,
        });
        notices.push(notice);
      }
    }

    const submittals = await this.store.getActiveSubmittals();
    for (const sub of submittals) {
      const dueDate = new Date(sub.due_date);
      const sla: SlaStatusResult = evaluateSlaStatus(dueDate, now);

      if (sla.status !== 'ok') {
        if (sla.status === 'warning_48h') warnings48h += 1;
        else if (sla.status === 'warning_24h') warnings24h += 1;
        else if (sla.status === 'breached') breaches += 1;

        const notice = await this.notifier.notify({
          aggregateType: 'submittal',
          aggregateId: sub.id,
          referenceNumber: sub.reference_number,
          title: sub.title,
          organizationId: sub.organization_id,
          projectId: sub.project_id,
          dueDate: dueDate.toISOString(),
          hoursRemaining: sla.hoursRemaining,
          status: sla.status,
          ballInCourtOrgId: sub.ball_in_court_organization_id,
        });
        notices.push(notice);
      }
    }

    this.logger.info(
      {
        checked_rfis: rfis.length,
        checked_submittals: submittals.length,
        warnings_48h: warnings48h,
        warnings_24h: warnings24h,
        breaches,
      },
      'SLA monitoring cycle finished',
    );

    return {
      checkedRfis: rfis.length,
      checkedSubmittals: submittals.length,
      warnings48h,
      warnings24h,
      breaches,
      notices,
    };
  }
}
