# VIN-MEGA-001 platform runtime proof

Status: `BLOCKED_RUNTIME`. This runbook is a future disposable-environment
procedure, not evidence that Docker or PostgreSQL has already passed. It must
not be used against production data or a shared database.

## Preconditions

- A Docker daemon and a task-owned PostgreSQL database are available.
- The database name is `vinops_mega001` or `vinops_mega001_test` for the
  deterministic seed guard.
- A database-administration identity is available only for migration/seed work.
- Distinct runtime identities can assume `vinops_app` and `vinops_worker`.
  They have no owner, superuser, or bypass-RLS capability.
- Non-secret task-owned environment values are supplied outside source control.

Run `docker version` once and capture the result. If the daemon is unavailable,
leave this checkpoint `BLOCKED_RUNTIME`; do not substitute SQLite, a mock, or a
production service.

## Required proof sequence

1. Run the migration and checksum verification using the administration
   connection described in `POSTGRESQL_MIGRATIONS.md`. Run the deterministic
   seed only against its guarded task-owned database name.
2. Connect using the application runtime identity. Within a transaction verify
   `SET LOCAL ROLE vinops_app`, then call `vinops.set_request_context` with a
   synthetic actor and correlation UUID. Confirm `current_user` is
   `vinops_app`; a direct owner/superuser connection is not valid evidence.
3. Using two seeded tenants or projects, prove allowed reads/writes succeed only
   for the request context's membership and cross-tenant reads/writes are
   denied or return no visible row through RLS. Include both `USING` and
   `WITH CHECK` behavior in the test.
4. Connect using the worker runtime identity. Within a transaction verify
   `SET LOCAL ROLE vinops_worker`, then prove it can use only the fixed
   `claim_outbox_events`, `mark_outbox_published`, and `mark_outbox_failed`
   functions for outbox work. It must not become a generic tenant-data query
   path.
5. Start the API with a task-owned PostgreSQL URL and auth secret. Exercise
   login, refresh, revoke, password reset, a protected read, and a protected
   idempotent mutation. Verify `Cache-Control: no-store`, the host-only
   `vinops_refresh` cookie attributes, session-bound CSRF/origin validation,
   authorization/tenant visibility errors, and no credential in logs.
6. Start the worker against the same disposable database. Prove one transactional
   outbox record is claimed, deterministically published, and marked or retried
   under the worker role. No external queue/provider is required or selected.
7. Exercise the web client against the API. Confirm it sends a Bearer access
   token from memory, relies on the HttpOnly refresh cookie with
   `credentials: include`, retains CSRF state only in memory, and does not
   persist credentials in browser storage.

## Evidence threshold

Record commands, exit codes, synthetic identifiers, expected/actual role, and
assertion results. Redact all connection strings, tokens, cookies, and auth
secrets. Static tests, migration-file inspection, and a successful app boot are
not substitutes for the role/RLS/runtime assertions above.

Only after all steps pass may the Executor propose `VIN-MEGA-001 -> VERIFY`.
Brain/Reviewer decides any subsequent state change. This procedure does not
clear the independent `VIN-FND-001A` advisory-audit or clean-room-residual
blockers.
