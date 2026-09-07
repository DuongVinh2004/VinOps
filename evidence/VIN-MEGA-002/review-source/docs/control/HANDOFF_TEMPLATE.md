# Handoff and evidence template

Keep the packet concise and within the work-order budget. Reference archived
artifacts rather than embedding them.

```text
===== EXECUTION_HANDOFF BEGIN =====
PROTOCOL_VERSION: 2.0
PACKET_TYPE: HANDOFF
PROJECT: VinOps
CHECKPOINT_ID: <id>
ITERATION: <n>
STATUS: READY_FOR_REVIEW | BLOCKED | FAILED
CONTEXT_MODE: STRICT
EVIDENCE_MODE: PATCH_FILE

INVARIANT: <single invariant>
BASELINE: <source identifiers and hashes>
DECISIONS: <approved CRs and unresolved decisions>
CONTROL_STATE_DELTA: <current -> proposed; Executor may propose VERIFY only>
CHANGES: <compact paths/counts>
ACCEPTANCE: <AC id -> PASS/FAIL/UNVERIFIED with evidence reference>
COMMAND_EVIDENCE: <command | exit_code | short_result>
EVIDENCE: <path | bytes | sha256 | purpose>
USER_WORK: <preservation statement>
EXTERNAL_ACTIONS: <none, or separately authorized actions>
REMAINING_UNVERIFIED: <gate-appropriate items>
NEXT_CANDIDATE: <identifier only; not executed>
===== EXECUTION_HANDOFF END =====
```

## Command record

Every command record uses:

```text
<exact command> | <integer exit code> | <one-line result and relevant count>
```

Do not write `PASS` for a command that was not run, timed out, or only checked
file presence. Mark those results `UNVERIFIED`, include the reason, and retain a
diagnostic log only when useful. Redact credentials, cookies, tokens, signed
URLs, environment values, and user data before archiving output.

## Archive record

Each ZIP has a JSON manifest listing the archive-relative filename, byte size,
and SHA-256 for every member. Verify by extracting to an exact temporary
directory and recomputing hashes. Evidence archives exclude `.git`,
`node_modules`, build output, coverage, caches, temporary files, secrets, and
external source documents.
