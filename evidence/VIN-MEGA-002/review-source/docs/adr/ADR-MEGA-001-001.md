# ADR-MEGA-001-001: PostgreSQL SQL migrations and Node-managed sessions

- Status: `ACCEPTED_PROVISIONAL`
- Effective date: 2026-07-30
- Decision owner: Product Owner authorization applies to the implementation
  baseline; security/runtime evidence remains Gate B.
- Checkpoint: `VIN-MEGA-001`

## Context

VinOps needs a reviewable platform baseline for tenant-scoped data,
authorization, session lifecycle, idempotent mutation, audit, and reliable
outbox delivery. The implementation must retain a clear boundary between the
database-administration capability and restricted application/worker runtime
capabilities. Docker/PostgreSQL integration proof is not yet available.

## Decision

1. PostgreSQL is the platform source of truth. Schema evolution is ordered SQL
   under `packages/database/migrations/`, executed by a dedicated migration
   runner that records SHA-256 checksums and rejects drift. No ORM is selected
   for this baseline.
2. Runtime uses the Node `pg` driver behind `@vinops/database`. Application
   transactions start explicitly, execute `SET LOCAL ROLE vinops_app`, then set
   actor and correlation context. Worker transactions execute
   `SET LOCAL ROLE vinops_worker` and expose only fixed outbox claim/mark
   operations, not a generic tenant-data query surface.
3. PostgreSQL RLS is enabled for the platform tables and policies use the
   request context and restricted roles as defense in depth. The migration
   principal is separate from runtime roles.
4. The Node API implements password hashing with `node:crypto` scrypt,
   short-lived HMAC-SHA256 access tokens, opaque hashed refresh credentials,
   session-family rotation/reuse handling, and a session-bound CSRF token.
   Browser refresh credentials use the approved HttpOnly `vinops_refresh`
   cookie; access and CSRF tokens stay in browser memory.
5. Business mutations write audit and outbox records in the same transaction.
   The worker polls/claims/publishes/marks these records with bounded retries;
   no external queue, Redis, or commercial provider is selected here.

## Alternatives considered

- **ORM-managed schema and data access:** not selected. It would add an
  abstraction over migration, role, RLS, and SQL review behavior that this
  checkpoint needs to keep explicit.
- **External identity provider or managed session service:** not selected.
  It would require separate provider, contractual, security, and runtime
  authorization that is outside this checkpoint.
- **Application role with direct owner/superuser capability:** rejected. It
  would bypass the least-privilege and RLS intent.

## Consequences and safeguards

SQL migration and query changes require direct review, migration checksum
verification, and RLS negative tests. Migrations are forward-only; use a
reviewed corrective migration or an environment-owner-approved restore, never a
destructive reset. Any change to state, RBAC, tenant visibility,
current-revision, idempotency, evidence, audit, cookie, CSRF, CORS, or error
semantics still requires an approved CR.

This is deliberately not a production-security approval. Before it can advance
beyond `VIN-MEGA-001: BLOCKED_RUNTIME`, a disposable Docker/PostgreSQL run must
prove role assumption, least privilege, cross-tenant RLS denial, migration and
seed behavior, authentication/session behavior, outbox processing, and API/web
integration. See `docs/runbooks/PLATFORM_RUNTIME.md`.
