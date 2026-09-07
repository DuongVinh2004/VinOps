import { describe, expect, it, vi } from 'vitest';
import {
  SlaMonitorWorker,
  type ActiveSlaCandidate,
  type SlaMonitorStore,
} from '../src/sla/sla-monitor.js';
import {
  EscalationNotifier,
  type EscalationSink,
  type SlaBreachNotice,
} from '../src/sla/escalation-notifier.js';
import { createSlaPoller } from '../src/sla/sla-poller.js';

class InMemorySlaStore implements SlaMonitorStore {
  constructor(
    private readonly rfis: ActiveSlaCandidate[] = [],
    private readonly submittals: ActiveSlaCandidate[] = [],
  ) {}

  getActiveRfis(): Promise<readonly ActiveSlaCandidate[]> {
    return Promise.resolve(this.rfis);
  }

  getActiveSubmittals(): Promise<readonly ActiveSlaCandidate[]> {
    return Promise.resolve(this.submittals);
  }
}

class TestEscalationSink implements EscalationSink {
  public recorded: SlaBreachNotice[] = [];

  recordEscalation(notice: SlaBreachNotice): Promise<void> {
    this.recorded.push(notice);
    return Promise.resolve();
  }
}

describe('SlaMonitorWorker', () => {
  const fixedNow = new Date('2026-09-07T12:00:00.000Z');
  const mockClock = () => fixedNow;

  it('correctly categorizes active RFIs into warning_48h, warning_24h, and breached', async () => {
    const rfis: ActiveSlaCandidate[] = [
      {
        id: 'rfi-1',
        organization_id: 'org-1',
        project_id: 'proj-1',
        reference_number: 'RFI-001',
        title: 'Concrete grade discrepancy',
        due_date: new Date('2026-09-08T10:00:00.000Z'), // 22 hours remaining -> warning_24h
        status: 'Under Review',
        ball_in_court_organization_id: 'org-consultant',
      },
      {
        id: 'rfi-2',
        organization_id: 'org-1',
        project_id: 'proj-1',
        reference_number: 'RFI-002',
        title: 'Rebar spacing query',
        due_date: new Date('2026-09-09T08:00:00.000Z'), // 44 hours remaining -> warning_48h
        status: 'Submitted',
        ball_in_court_organization_id: 'org-consultant',
      },
      {
        id: 'rfi-3',
        organization_id: 'org-1',
        project_id: 'proj-1',
        reference_number: 'RFI-003',
        title: 'Foundation waterproofing',
        due_date: new Date('2026-09-06T12:00:00.000Z'), // in past -> breached
        status: 'Under Review',
        ball_in_court_organization_id: 'org-lead',
      },
      {
        id: 'rfi-4',
        organization_id: 'org-1',
        project_id: 'proj-1',
        reference_number: 'RFI-004',
        title: 'HVAC shaft dimension',
        due_date: new Date('2026-09-20T12:00:00.000Z'), // far future -> ok
        status: 'Submitted',
        ball_in_court_organization_id: 'org-consultant',
      },
    ];

    const store = new InMemorySlaStore(rfis, []);
    const sink = new TestEscalationSink();
    const notifier = new EscalationNotifier(sink, mockClock);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const worker = new SlaMonitorWorker(store, notifier, logger, mockClock);
    const report = await worker.runOnce();

    expect(report.checkedRfis).toBe(4);
    expect(report.checkedSubmittals).toBe(0);
    expect(report.warnings24h).toBe(1);
    expect(report.warnings48h).toBe(1);
    expect(report.breaches).toBe(1);
    expect(report.notices.length).toBe(3);

    expect(sink.recorded).toHaveLength(3);
    expect(sink.recorded[0]!.aggregateId).toBe('rfi-1');
    expect(sink.recorded[0]!.status).toBe('warning_24h');
    expect(sink.recorded[1]!.aggregateId).toBe('rfi-2');
    expect(sink.recorded[1]!.status).toBe('warning_48h');
    expect(sink.recorded[2]!.aggregateId).toBe('rfi-3');
    expect(sink.recorded[2]!.status).toBe('breached');
  });

  it('correctly processes submittal SLA breaches', async () => {
    const submittals: ActiveSlaCandidate[] = [
      {
        id: 'sub-1',
        organization_id: 'org-1',
        project_id: 'proj-1',
        reference_number: 'SUB-001',
        title: 'Tiles sample approval',
        due_date: new Date('2026-09-05T00:00:00.000Z'), // breached
        status: 'Under Review',
        ball_in_court_organization_id: 'org-consultant',
      },
    ];

    const store = new InMemorySlaStore([], submittals);
    const sink = new TestEscalationSink();
    const notifier = new EscalationNotifier(sink, mockClock);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const worker = new SlaMonitorWorker(store, notifier, logger, mockClock);
    const report = await worker.runOnce();

    expect(report.checkedSubmittals).toBe(1);
    expect(report.breaches).toBe(1);
    expect(sink.recorded[0]!.aggregateType).toBe('submittal');
    expect(sink.recorded[0]!.aggregateId).toBe('sub-1');
  });

  it('runs poller start and stop cleanly', async () => {
    const store = new InMemorySlaStore([], []);
    const sink = new TestEscalationSink();
    const notifier = new EscalationNotifier(sink, mockClock);
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const worker = new SlaMonitorWorker(store, notifier, logger, mockClock);

    const poller = createSlaPoller(worker, logger, 50);
    expect(poller.isRunning).toBe(false);

    poller.start();
    expect(poller.isRunning).toBe(true);

    await poller.stop();
    expect(poller.isRunning).toBe(false);
  });
});
