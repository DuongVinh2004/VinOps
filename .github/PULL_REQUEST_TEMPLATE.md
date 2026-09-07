## Summary of Changes

<!-- Provide a concise description of the motivation and technical changes introduced by this PR. -->

## Type of Change

- [ ] `feat`: New capability or public API addition
- [ ] `fix`: Bug fix or defect remediation
- [ ] `perf`: Performance optimization
- [ ] `refactor`: Structural improvement without changing behavior
- [ ] `docs`: Documentation, runbook, or ADR updates
- [ ] `test`: New or modified test suites
- [ ] `chore`: Toolchain, dependency, or workflow maintenance

## Architectural & Security Impact

- [ ] Modifies database migrations or RLS policies (`packages/database/migrations`)
- [ ] Modifies OpenAPI contract schema (`packages/contracts/openapi`)
- [ ] Alters authentication, authorization, or session handling (`apps/api`)
- [ ] Alters file upload, quarantine, or malware pipeline (`packages/file`, `apps/worker`)
- [ ] None of the above

## Quality Gate Checklist

Before requesting review, ensure that all local quality gates pass:

- [ ] Ran `pnpm verify` locally and all 9 gates passed:
  - [ ] `pnpm format:check`
  - [ ] `pnpm lint`
  - [ ] `pnpm typecheck`
  - [ ] `pnpm test`
  - [ ] `pnpm contracts:verify`
  - [ ] `pnpm architecture:check`
  - [ ] `pnpm build`
  - [ ] `pnpm secret:scan`
  - [ ] `pnpm license:check`
- [ ] Added unit or integration tests verifying the change
- [ ] Preserved all existing documentation integrity and comments
- [ ] No secrets, credentials, or production tokens committed

## Related Issues & References

<!-- Example: Closes #123, Implements ADR-015 -->

- Fixes:
- Related:
