# Module-boundary contract

VinOps starts as a modular monolith with a separate worker process. Process
boundaries do not grant modules permission to bypass domain ownership.

## Allowed dependency direction

```text
apps/api -------> packages/config, packages/domain, packages/database,
                  packages/observability, packages/contracts (public contract only)
apps/worker ----> packages/config, packages/database, packages/observability
apps/web -------> packages/config and the HTTP API only

packages/database ------> packages/domain, packages/observability
packages/config --------X apps/*
packages/contracts -----X apps/*
packages/domain --------X apps/*, NestJS, HTTP, ORM, pg, queue/provider SDKs
packages/observability -X apps/*
```

Shared foundation packages may depend on narrowly scoped third-party libraries
needed for their own responsibility, but never on an app. Future domain code
must not import NestJS, HTTP, ORM, database drivers, or provider SDKs. Web code
must not import server implementation; it talks to the API over HTTP and keeps
access/CSRF state only in memory. Imports cross a package through its public
export, never an internal path. Cycles are forbidden.

`packages/database` is the only package allowed to create a `pg` pool, run a
migration, or issue `SET LOCAL ROLE`. The API may use its transaction interface
only after `vinops_app` has been assumed and the request actor/correlation
context has been set. The worker may use only the outbox-specific transaction
interface after `vinops_worker` has been assumed. Runtime code must not connect
as `vinops_owner`, superuser, or a role that bypasses RLS.

The role transition is transaction-local and must be explicit:

```sql
BEGIN;
SET LOCAL ROLE vinops_app;
SELECT vinops.set_request_context(:actor_user_id, :correlation_id);
-- application transaction statements
COMMIT;
```

Worker outbox transactions use `SET LOCAL ROLE vinops_worker` instead and do
not set an application actor context. Both transitions require runtime proof;
the SQL block documents the intended boundary, not a successful PostgreSQL run.

Each future business module owns its vocabulary, state transitions, policies,
and persistence access. Another module communicates through an explicit public
contract; it must not read or write the owner's tables directly. State, RBAC,
tenant/current-revision, idempotency, and evidence semantics require an approved
CR before their contract changes.

The platform baseline writes audit/outbox records atomically with its mutation.
An outbox publisher may consume only its explicit event contract; it does not
reconstruct authorization or change tenant data. Adding a provider, queue, or
cross-module persistence path requires a new authorization and boundary review.

## Rule for opening a module

Open a new module only when all of these are true:

1. The active checkpoint requires a concrete behavior owned by the module.
2. Its invariant, vocabulary, owner, inputs, outputs, and public contract are
   named.
3. Its dependencies follow the direction above and do not create a cycle.
4. Tests can prove behavior and cross-module isolation.
5. Any controlled semantic decision is already authorized by PRSS or a CR.
6. The package contains real implementation for the checkpoint, not an empty
   future placeholder.

Run `corepack pnpm@11.15.1 run architecture:check` after boundary-affecting
changes. Review generated dependency or contract code like hand-written code.
The current role/RLS model is implementation evidence only until PostgreSQL
runtime verification completes; see `docs/control/CONTROL_STATE.md`.
