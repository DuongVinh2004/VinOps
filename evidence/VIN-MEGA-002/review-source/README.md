# VinOps platform baseline

This repository contains the `VIN-FND-001A` toolchain foundation and the
provisional `VIN-MEGA-001` platform implementation baseline. It is not a
production deployment and it has not yet passed Docker/PostgreSQL runtime
proof. See `docs/control/CONTROL_STATE.md` for the checkpoint states.

## Pinned toolchain

- Node.js `24.18.0` (Node 24 LTS line)
- pnpm `11.15.1` through Corepack
- TypeScript `5.9.3`, selected by compatibility proof: TypeScript 7.0.2 and 6.x are outside required tool peer ranges

Use the exact package manager without a global install:

```text
corepack pnpm@11.15.1 install --frozen-lockfile
corepack pnpm@11.15.1 verify
```

Copy `.env.example` values into a local, ignored environment file or set them in the process environment. The example contains identifiers and local URLs only, never credentials.

## Platform implementation boundary

`VIN-MEGA-001` chooses PostgreSQL as the source of truth and keeps migrations
as reviewed SQL in `packages/database/migrations/`; it does not use an ORM.
The migration runner records checksums, rejects drift, and uses forward
corrective migrations rather than generic down migrations.

- `apps/api`: NestJS HTTP API, health endpoints, strict CORS/error behavior,
  platform operations, and the Node-managed session/authentication flow.
- `apps/worker`: NestJS worker that claims and marks outbox events through
  restricted database functions; no queue or external publisher is selected.
- `apps/web`: React/Vite web client that talks to the HTTP API. Access and CSRF
  tokens are retained in browser memory; the refresh credential remains an
  HttpOnly cookie.
- `packages/database`: PostgreSQL transaction boundary, migrations, deterministic
  task-owned seed, RLS policy, and least-privilege role handling.
- `packages/domain`: framework-free platform vocabulary and invariants.
- `packages/config`: process-specific typed configuration.
- `packages/contracts`: OpenAPI Candidate working copy, CR-002 overlay, and
  generated types.
- `packages/observability`: structured logging, redaction, and correlation
  context.

Application transactions begin explicitly, execute `SET LOCAL ROLE vinops_app`,
and set an actor/correlation request context. Worker transactions execute
`SET LOCAL ROLE vinops_worker` and are limited to fixed outbox functions. The
migration principal is separate from runtime capabilities. These controls are
implemented but remain runtime-unverified until a disposable Docker/PostgreSQL
exercise proves them.

## Foundation gates

`pnpm verify` runs formatting, lint, strict typecheck/project references, unit/contract tests, OpenAPI lint and generation drift, architecture/cycle checks, builds, secret scan and direct-license policy. Dependency audit is intentionally separate because it queries the registry:

```text
corepack pnpm@11.15.1 audit --audit-level high
```

CI mirrors these commands. It does not deploy, publish, migrate, create
infrastructure, or use production secrets.

Read [the provisional PostgreSQL and Node-auth ADR](docs/adr/ADR-MEGA-001-001.md),
[module boundaries](docs/architecture/MODULE_BOUNDARIES.md), and the
[PostgreSQL runbook](docs/runbooks/POSTGRESQL_MIGRATIONS.md) before changing
database, authorization, session, outbox, or API behavior. Source precedence
and agent rules are defined in `AGENTS.md`; current checkpoint state is under
`docs/control/`.
