# VinOps repository instructions

These instructions apply to the entire repository. A more specific `AGENTS.md`
may narrow implementation details, but it may not weaken these controls.

## Authority and source precedence

Resolve conflicts in this order:

1. PRSS v3.1 Approved Provisional Baseline.
2. Product Owner decisions and approved change requests (CRs).
3. Design v1.0 Candidate.
4. OpenAPI v1 Candidate.
5. The engineering-readiness overlay.
6. Repository implementation.

The external source documents and readiness directory are read-only from this
repository. A lower-precedence source must never silently override a higher one.
When a conflict affects product meaning, stop and raise a CR; do not encode an
assumption in code.

## Operating roles

- **Brain/Reviewer** defines the checkpoint invariant, evaluates concise
  evidence, records the review decision, and is the only role that may accept
  closure.
- **Executor** implements the authorized scope, runs the required checks,
  preserves user work, and submits evidence. The Executor may propose `VERIFY`
  but must not mark its own checkpoint `CLOSED`.

One checkpoint proves one invariant. Do not expand a checkpoint into the next
candidate checkpoint because tooling or scaffolding makes that convenient.

## Control lifecycle and context

The only checkpoint lifecycle is:

`OPEN -> IN_PROGRESS -> VERIFY -> CLOSED` or `BLOCKED`.

`BLOCKED` requires a concrete external blocker and evidence of the attempted
safe path. It is not a substitute for incomplete work. Moving from `VERIFY` to
`CLOSED` requires Brain/Reviewer acceptance.

Keep the active invariant, changed claims, decisions, blockers, and current
command evidence in **hot context**. Keep full source material, prior accepted
findings, complete logs, dependency trees, and historical bundles in **cold
context** as referenced artifacts. Do not repeat a full audit when the source
hash, relevant claim, and invariant are unchanged. Re-check only the changed
claim against its authoritative source.

Use reviewable patches and archived evidence instead of pasting complete files,
full diffs, or long successful logs into a handoff. The default handoff budget
for `VIN-FND-001A` is 2,200 tokens. A handoff must still identify the invariant,
state delta, decisions, commands with exit codes, concise results, changed-file
manifest, and evidence hashes.

## Change controls

A CR is mandatory before changing the semantics of any of the following:

- workflow state or transition rules;
- RBAC, scope, separation-of-duty, or visibility behavior;
- tenant isolation or resource-existence disclosure;
- current-revision selection or immutable evidence history;
- idempotency, retry, outbox, or concurrency guarantees;
- audit/evidence meaning, retention, or correlation;
- authentication, cookie, CSRF, CORS, or error-contract behavior.

Generated source is production source: review it, test it, scan it, and include
it in drift checks exactly as hand-written code. A generator never grants
approval to the generated result.

Do not commit, push, open or merge a pull request, publish, release, provision,
or deploy without explicit authority for that external action. Never use real
secrets or production data. Do not install plugins, connectors, custom skills,
global CLIs, or IDE extensions for repository work.

## Repository boundaries

- Application entry points live under `apps/`.
- Reusable foundation capabilities live under `packages/`.
- Shared packages must not import an application.
- The web app must not import server implementation.
- Future domain code must remain independent of NestJS, HTTP, ORM, and provider
  SDKs.
- Import through package public exports; do not deep-import another module's
  internals or read another module's persistence tables.
- No circular dependency is allowed.

Open a new module only when it owns a distinct invariant and vocabulary, has a
named public contract and owner, respects the dependency direction, and has a
real testable use in the active checkpoint. Do not create empty packages for a
future architecture diagram. See `docs/architecture/MODULE_BOUNDARIES.md`.

## Required local evidence

Use the exact package manager declared by root `package.json` and the committed
lockfile. The standard foundation sequence is:

```text
node --version
corepack pnpm@11.15.1 --version
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

Record each command as `command | exit_code | short_result`. A PASS requires an
exit code of zero and an assertion-bearing check; absence of output or the
existence of a file is not sufficient. Preserve full logs in evidence storage
only when needed for diagnosis or review.

The current operating model is `AGENTS.md + control-state + templates`. Do not
create or install a custom skill for it.
