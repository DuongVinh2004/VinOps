# PostgreSQL migration and rollback runbook

`VIN-MEGA-001` uses PostgreSQL SQL migrations only. The application process uses
a least-privilege runtime role; a separate database-administration principal
runs migrations. Do not use SQLite or an in-memory substitute to validate these
invariants.

Current checkpoint state: `BLOCKED_RUNTIME`. The commands below define the
required disposable runtime proof; they have not established a Docker/PostgreSQL
PASS in this checkpoint.

## Preconditions

- PostgreSQL 16+ database created specifically for VinOps local/test work.
- A database-administration connection string supplied through `VINOPS_DATABASE_URL` only for migration/seed commands.
- Application login is provisioned externally with the capability to assume
  `vinops_app`; worker login is provisioned externally with the capability to
  assume `vinops_worker`. The migration intentionally creates no passwords or
  LOGIN roles. Neither runtime identity may use `vinops_owner`, superuser, or a
  bypass-RLS role.
- Target is empty for a rehearsal. The deterministic seed command refuses any database name other than `vinops_mega001` or `vinops_mega001_test`.

## Precheck and apply

```text
corepack pnpm@11.15.1 --filter @vinops/database build
VINOPS_DATABASE_URL=<task-owned-url> corepack pnpm@11.15.1 --filter @vinops/database migrate
VINOPS_DATABASE_URL=<task-owned-url> corepack pnpm@11.15.1 --filter @vinops/database migration:verify
VINOPS_DATABASE_URL=<task-owned-url> corepack pnpm@11.15.1 --filter @vinops/database seed
```

The runner takes a transaction advisory lock, stores a SHA-256 checksum for
every migration, and refuses drift. Verification checks the migration set and
the expected RLS-protected table count. Record the output as pending runtime
evidence; a migration command alone is not a role/RLS/API proof.

## Verify queries

```sql
SELECT name, checksum, applied_at FROM vinops.schema_migrations ORDER BY name;
SELECT tablename FROM pg_tables WHERE schemaname = 'vinops' AND rowsecurity ORDER BY tablename;
SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'vinops' ORDER BY tablename, policyname;
SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname IN ('vinops_owner', 'vinops_app', 'vinops_worker');
```

After migration, use the disposable runtime procedure in
`PLATFORM_RUNTIME.md` to prove `SET LOCAL ROLE`, denied cross-tenant access, and
worker-only outbox function access. Do not infer those properties from static
SQL review.

## Rollback strategy

Migrations are forward-only; there is no unsafe generic down migration. Before applying to any non-disposable environment, take the approved backup/snapshot through the environment owner. If a migration must be reversed, apply a reviewed forward corrective migration or restore the approved pre-migration backup through the environment owner. Never drop VinOps schemas, tables, roles, or volumes as a substitute for rollback.
