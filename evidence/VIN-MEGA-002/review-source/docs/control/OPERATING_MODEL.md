# Repository operating model

## Purpose

VinOps work is delivered as independently reviewable checkpoints. Each
checkpoint has one invariant, an explicit authority boundary, a bounded patch,
and reproducible evidence. The model separates implementation from acceptance
so an Executor cannot certify its own work.

## Precedence and conflict handling

The controlling order is PRSS v3.1, approved Product Owner decisions/CRs,
Design v1.0 Candidate, OpenAPI v1 Candidate, readiness overlay, then repository
implementation. Status differences without a content conflict may be reconciled
by an approved CR. A content conflict must be surfaced; implementation cannot
silently rewrite PRSS.

The Design and OpenAPI candidates are authorized implementation inputs for the
foundation, not globally approved product, security, runtime, or customer
evidence. Their Candidate labels remain until their own gates pass.

## Brain/Reviewer and Executor

The Brain/Reviewer creates or accepts the work order, makes its invariant and
acceptance criteria testable, and reviews the resulting patch and evidence. It
may request rework, mark a genuine blocker, or close a verified checkpoint.

The Executor performs only the authorized mutation, runs checks proportionate
to risk, and reports the proposed state delta. It must preserve unrelated user
work and may not fabricate another role's sign-off. Its terminal successful
proposal is `VERIFY`, never `CLOSED`.

## One checkpoint, one invariant

Checkpoint scope may contain several files and checks, but every one must
support the same invariant. `VIN-FND-001A` proves that a new developer or CI
runner can install the exact toolchain and execute the foundation gates without
guessing architecture, versions, environment variables, requirement sources,
or agent process. Database schemas, authentication runtime, business features,
and the next checkpoint are outside that invariant.

## Hot and cold context

Hot context contains only the current work order, source hashes, accepted CRs,
changed claims, open blockers, compact control state, and the latest command
summary. Cold context contains unchanged source documents, previous manifests,
complete logs, old bundles, and accepted findings.

If the relevant source hash, finding, and invariant are unchanged, reference the
cold artifact and do not run a full re-audit. Re-check an authoritative source
only when a claim depending on it changed or is time-sensitive.

## Patch and evidence discipline

- Prefer a focused patch over a bulk rewrite.
- Archive large evidence and identify it by path, size, and SHA-256.
- A manifest enumerates every archived file and hash.
- Handoffs contain summaries, not full source, full diffs, full dependency
  trees, or full successful logs.
- `VIN-FND-001A` uses a 2,200-token handoff budget unless a later work order
  explicitly changes it.

Use the handoff and command formats in `HANDOFF_TEMPLATE.md`. A state change
must cite the evidence that permits it.

## Lifecycle

`OPEN -> IN_PROGRESS -> VERIFY -> CLOSED` is the successful path. `BLOCKED` is
allowed from an active state only for a concrete external blocker. The Executor
records a proposed delta; Brain/Reviewer records the reviewed delta. Rework
returns the checkpoint to `IN_PROGRESS` without erasing prior evidence.

No repository instruction authorizes commit, push, PR, merge, release, cloud
provisioning, or deployment. Those actions require separate explicit authority.

## Semantic change requests

State, RBAC, tenant visibility, current-revision, immutable evidence,
idempotency, audit meaning, and authentication/error-contract semantics are
controlled behavior. A change to them requires a CR that states the proposal,
alternatives, impact, reversibility, approver, required evidence, target gate,
and status. Generated code implementing those behaviors remains subject to the
same review and tests as hand-written code.
