import type { Logger } from 'pino';

export type SlaBreachNotice = {
  aggregateType: 'rfi' | 'submittal';
  aggregateId: string;
  referenceNumber: string;
  title: string;
  organizationId: string;
  projectId: string;
  dueDate: string;
  hoursRemaining: number;
  status: 'warning_48h' | 'warning_24h' | 'breached';
  ballInCourtOrgId: string | null;
  notifiedAt: string;
};

export interface EscalationSink {
  recordEscalation(notice: SlaBreachNotice): Promise<void>;
}

export class LoggingEscalationSink implements EscalationSink {
  constructor(private readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>) {}

  recordEscalation(notice: SlaBreachNotice): Promise<void> {
    if (notice.status === 'breached') {
      this.logger.error(
        {
          aggregate_type: notice.aggregateType,
          aggregate_id: notice.aggregateId,
          ref: notice.referenceNumber,
          hours_remaining: notice.hoursRemaining,
          ball_in_court: notice.ballInCourtOrgId,
        },
        'SLA BREACH DETECTED: Escalating to PM/CHT',
      );
    } else {
      this.logger.warn(
        {
          aggregate_type: notice.aggregateType,
          aggregate_id: notice.aggregateId,
          ref: notice.referenceNumber,
          hours_remaining: notice.hoursRemaining,
          status: notice.status,
        },
        'SLA WARNING: Approaching due date',
      );
    }
    return Promise.resolve();
  }
}

export class EscalationNotifier {
  constructor(
    private readonly sink: EscalationSink,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async notify(notice: Omit<SlaBreachNotice, 'notifiedAt'>): Promise<SlaBreachNotice> {
    const fullNotice: SlaBreachNotice = {
      ...notice,
      notifiedAt: this.clock().toISOString(),
    };
    await this.sink.recordEscalation(fullNotice);
    return fullNotice;
  }
}
