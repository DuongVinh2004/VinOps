import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));

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
    ],
    setupFiles: ['apps/web/test/setup.ts'],
    testTimeout: 15_000,
  },
});
