import { describe, expect, it, vi } from 'vitest';
import { createWorkerApplication, enableWorkerGracefulShutdown } from '../src/bootstrap.js';

describe('worker foundation', () => {
  it('boots a typed Nest application context and shuts it down cleanly', async () => {
    const worker = await createWorkerApplication({
      NODE_ENV: 'test',
      VINOPS_LOG_LEVEL: 'silent',
      VINOPS_WORKER_NAME: 'worker-test',
    });

    expect(worker.config.VINOPS_WORKER_NAME).toBe('worker-test');
    expect(worker.lifecycle.isRunning).toBe(true);

    await worker.shutdown();
    expect(worker.lifecycle.isRunning).toBe(false);
  });

  it('registers only the expected graceful-shutdown signals', () => {
    const enableShutdownHooks = vi.fn();
    enableWorkerGracefulShutdown({ enableShutdownHooks });
    expect(enableShutdownHooks).toHaveBeenCalledWith(['SIGINT', 'SIGTERM']);
  });
});
