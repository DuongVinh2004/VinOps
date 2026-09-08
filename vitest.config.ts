import { fileURLToPath } from 'node:url';
import type { File, Reporter, Task } from 'vitest';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

function isTaskSkipped(task: Task): boolean {
  if (task.mode === 'skip' || task.result?.state === 'skip') {
    return true;
  }
  if ('tasks' in task && Array.isArray(task.tasks)) {
    return task.tasks.some(isTaskSkipped);
  }
  return false;
}

export const ciIntegrationSkipGuard: Reporter = {
  onFinished(files: File[] = []) {
    const isCi = process.env.CI === 'true' || process.env.CI === '1';
    if (!isCi) {
      return;
    }
    const requiredPatterns = [/rls-tenant-isolation/, /worker-fault-injection/, /\.integration\./];
    for (const file of files) {
      const isRequired = requiredPatterns.some((pattern) => pattern.test(file.filepath));
      if (!isRequired) {
        continue;
      }
      const hasNoExecutedTests =
        file.tasks.length === 0 ||
        file.tasks.every((t) => t.mode === 'skip' || t.result?.state === 'skip');
      const hasSkipped = file.mode === 'skip' || file.tasks.some(isTaskSkipped);
      if (hasSkipped || hasNoExecutedTests) {
        process.exitCode = 1;
        throw new Error(
          `[CI GUARD] Required integration test suite "${file.filepath}" was skipped or had skipped tests in CI environment. Integration tests must not be bypassed in CI.`,
        );
      }
    }
  },
};

export default defineConfig({
  resolve: {
    alias: {
      '@vinops/config': `${root}packages/config/src/index.ts`,
      '@vinops/contracts': `${root}packages/contracts/src/index.ts`,
      // Resolve the implementation directly so tests cannot load stale
      // JavaScript artifacts that may exist beside the TypeScript source.
      '@vinops/database': `${root}packages/database/src/database.ts`,
      '@vinops/domain': `${root}packages/domain/src/index.ts`,
      '@vinops/file': `${root}packages/file/src/index.ts`,
      '@vinops/observability': `${root}packages/observability/src/index.ts`,
    },
  },
  test: {
    include: [
      'apps/*/test/**/*.{test,spec,e2e-spec}.{ts,tsx}',
      'packages/*/test/**/*.{test,spec}.ts',
      'packages/*/src/**/__tests__/**/*.{test,spec}.ts',
      'tests/**/*.{test,spec}.ts',
    ],
    setupFiles: ['apps/web/test/setup.ts'],
    testTimeout: 15_000,
    reporters: ['default', ciIntegrationSkipGuard],
  },
});
