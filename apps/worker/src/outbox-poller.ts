import type { Logger } from 'pino';
import type { OutboxWorker } from './outbox-worker.js';

export type OutboxPoller = {
  readonly isRunning: boolean;
  start(): void;
  stop(): Promise<void>;
};

function safeErrorKind(error: unknown): string {
  return error instanceof Error && error.name.length > 0 ? error.name : 'UNKNOWN_ERROR';
}

export function createOutboxPoller(
  worker: OutboxWorker,
  logger: Pick<Logger, 'debug' | 'error'>,
  intervalMs: number,
): OutboxPoller {
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
      if (report.claimed > 0) {
        logger.debug({ outbox: report }, 'outbox polling pass completed');
      }
    } catch (error) {
      logger.error({ error_kind: safeErrorKind(error) }, 'outbox polling pass failed');
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
