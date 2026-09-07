import type { Logger } from 'pino';
import type { FileProcessingWorker } from './file-processing-worker.js';

export type FileProcessingPoller = {
  readonly isRunning: boolean;
  start(): void;
  stop(): Promise<void>;
};

export function createFileProcessingPoller(
  worker: FileProcessingWorker,
  logger: Pick<Logger, 'debug' | 'error'>,
  intervalMs: number,
): FileProcessingPoller {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activePoll: Promise<void> | undefined;
  const schedule = (): void => {
    if (!running) return;
    timer = setTimeout(() => {
      activePoll = runPoll();
    }, intervalMs);
    timer.unref();
  };
  const runPoll = async (): Promise<void> => {
    if (!running) return;
    try {
      const report = await worker.runOnce();
      if (report.claimed > 0)
        logger.debug({ file_processing: report }, 'file polling pass completed');
    } catch (error) {
      logger.error(
        { error_kind: error instanceof Error ? error.name : 'UNKNOWN_ERROR' },
        'file polling pass failed',
      );
    } finally {
      schedule();
    }
  };
  return {
    get isRunning(): boolean {
      return running;
    },
    start(): void {
      if (running) return;
      running = true;
      activePoll = runPoll();
    },
    async stop(): Promise<void> {
      running = false;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      await activePoll;
    },
  };
}
