import type { Logger } from 'pino';
import type { SlaMonitorWorker } from './sla-monitor.js';

export type SlaPoller = {
  readonly isRunning: boolean;
  start(): void;
  stop(): Promise<void>;
};

function safeErrorKind(error: unknown): string {
  return error instanceof Error && error.name.length > 0 ? error.name : 'UNKNOWN_ERROR';
}

export function createSlaPoller(
  worker: SlaMonitorWorker,
  logger: Pick<Logger, 'debug' | 'error' | 'info'>,
  intervalMs: number,
): SlaPoller {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activePoll: Promise<void> | undefined;

  const schedule = (): void => {
    if (!running) {
      return;
    }
    timer = setTimeout(() => {
      activePoll = runPoll();
    }, intervalMs);
    timer.unref();
  };

  const runPoll = async (): Promise<void> => {
    if (!running) {
      return;
    }
    try {
      const report = await worker.runOnce();
      if (report.warnings48h > 0 || report.warnings24h > 0 || report.breaches > 0) {
        logger.info(
          {
            warnings48h: report.warnings48h,
            warnings24h: report.warnings24h,
            breaches: report.breaches,
          },
          'sla monitor detected warnings or breaches',
        );
      }
    } catch (error) {
      logger.error({ error_kind: safeErrorKind(error) }, 'sla monitor polling pass failed');
    } finally {
      schedule();
    }
  };

  return {
    get isRunning(): boolean {
      return running;
    },
    start(): void {
      if (running) {
        return;
      }
      running = true;
      activePoll = runPoll();
    },
    async stop(): Promise<void> {
      running = false;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await activePoll;
    },
  };
}
