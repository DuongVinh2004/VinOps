# Local foundation runbook

This runbook verifies `VIN-FND-001A`; it does not start database, queue,
authentication, migration, or business-feature work.

## Prerequisites

- Repository path: `C:\Users\Duong Vinh\Downloads\VinOps\vinops` on the current
  workstation, or a clean clone elsewhere.
- Node `24.18.0` (the repository files constrain the Node 24 LTS major).
- pnpm `11.15.1` through Corepack, matching `packageManager`.
- No real secret or production data. Use only documented non-secret development
  values based on `.env.example`.

From the repository root, confirm versions before installation:

```text
node --version
corepack pnpm@11.15.1 --version
```

Stop when the Node major is not 24 or the pnpm version is not exactly 11.15.1.
Do not install a global replacement.

## Install and verify

```text
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 run format:check
corepack pnpm@11.15.1 run lint
corepack pnpm@11.15.1 run typecheck
corepack pnpm@11.15.1 run test
corepack pnpm@11.15.1 run contracts:verify
corepack pnpm@11.15.1 run architecture:check
corepack pnpm@11.15.1 run build
corepack pnpm@11.15.1 run secret:scan
corepack pnpm@11.15.1 run license:check
git diff --check
git status --short
```

Do not regenerate the lockfile during a verification run. Record every command
as `command | exit_code | short_result`. Investigate failures; do not lower
strictness, enable `skipLibCheck`, relax peer checks, or suppress broad errors.

## Process smoke checks

Start only the process being inspected. The API must expose `/health/live` and
`/health/ready`, return structured logs with correlation context, and terminate
gracefully. The worker must boot and terminate cleanly without a real queue or
provider. The web app must render the foundation shell and error boundary
without storing credentials.

Use test commands as the authoritative smoke proof; do not mark readiness from a
manual browser observation alone. Docker daemon availability is not a
FND-001A failure. If checked, run `docker version` once, record the result, and
leave database/queue/storage runtime proof `UNVERIFIED` at Gate B.

## Clean-room proof

Create one uniquely named temporary directory outside the working tree. Copy
only repository source; exclude `.git`, `node_modules`, `dist`, coverage, cache,
evidence bundles, environment files, and all external source/readiness files.
In that copy, run frozen install, format check, lint, typecheck, tests, contract
verification, architecture check, and build.

Compare the clean-room command summary with local and CI commands. Remove only
the exact temporary directory created for this run after its path has been
resolved and verified. Never clean or reset the primary workspace to obtain a
green result.

## Historical checkpoint status

`VIN-FND-001A` remains `BLOCKED`. Its two recorded blockers are: (1) a
registry-backed High/Critical advisory audit cannot complete under the current
egress policy, and (2) a clean-room `node_modules` residual cannot be removed
safely because package-manager hardlinks resolve outside the workspace. Do not
clear either blocker by deleting outside the repository or waiving the audit.

`VIN-MEGA-001` does not change this historical foundation status. PostgreSQL
runtime instructions are in `POSTGRESQL_MIGRATIONS.md` and
`PLATFORM_RUNTIME.md`; they are pending a disposable Docker/PostgreSQL proof.

## Evidence and escalation

Archive the changed-file manifest, command summary, dependency/license summary,
test summary, and a reviewable patch. Evidence bundles must exclude dependency
trees, build output, caches, secrets, user data, and source inputs. No evidence
archive is created by the `VIN-MEGA-001` documentation update. Gate B/C and
`VIN-FND-001B` remain outside this runbook.
