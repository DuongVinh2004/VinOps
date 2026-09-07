module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'packages-do-not-depend-on-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'api-does-not-import-other-apps',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: { path: '^apps/(worker|web)/' },
    },
    {
      name: 'worker-does-not-import-other-apps',
      severity: 'error',
      from: { path: '^apps/worker/' },
      to: { path: '^apps/(api|web)/' },
    },
    {
      name: 'web-does-not-import-server',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^apps/(api|worker)/' },
    },
    {
      name: 'future-domain-is-framework-free',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: { path: 'node_modules/(@nestjs|express|typeorm|prisma|pg|redis|bullmq)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^(apps|packages)/',
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    reporterOptions: { dot: { collapsePattern: 'node_modules/[^/]+' } },
  },
};
