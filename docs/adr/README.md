# Architecture decision control

ADRs explain durable architecture choices; they do not replace PRSS or an
approved semantic CR. Use `CANDIDATE`, `ACCEPTED_PROVISIONAL`, `ACCEPTED`, or
`SUPERSEDED`, record the decision owner and effective date, and link evidence to
the target gate. Never infer a missing specialist sign-off.

The Product Owner reconciliation effective 2026-07-30 is:

| ADR     | Status                 | Deferred proof                                          |
| ------- | ---------------------- | ------------------------------------------------------- |
| ADR-001 | `ACCEPTED_PROVISIONAL` | Implementation evidence                                 |
| ADR-002 | `ACCEPTED`             | Tenant/RLS negative-test proof remains Gate B           |
| ADR-003 | `ACCEPTED_PROVISIONAL` | Security and runtime proof remains Gate B               |
| ADR-004 | `ACCEPTED`             | Implementation evidence                                 |
| ADR-005 | `ACCEPTED`             | Implementation evidence                                 |
| ADR-006 | `ACCEPTED`             | Implementation evidence                                 |
| ADR-007 | `CANDIDATE`            | Device, network, and customer validation remains Gate C |
| ADR-008 | `ACCEPTED`             | Implementation evidence                                 |
| ADR-009 | `ACCEPTED`             | Implementation evidence                                 |
| ADR-010 | `ACCEPTED`             | Implementation evidence                                 |
| ADR-011 | `ACCEPTED`             | Implementation evidence                                 |
| ADR-012 | `ACCEPTED_PROVISIONAL` | Implementation evidence                                 |

Before changing workflow state, RBAC, tenant visibility, current-revision,
evidence, audit, idempotency, or auth/error-contract semantics, create a CR with
the proposal, alternatives, impact, reversibility, approver, required evidence,
target gate, and decision status. An ADR may link the CR but cannot approve it.

Create a repository ADR only when the choice is durable, has meaningful
alternatives or consequences, and falls within the active work order. Avoid
placeholder ADRs for undecided providers.

## Repository-local provisional ADRs

| ADR                                     | Status                 | Scope                                                                             |
| --------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| [ADR-MEGA-001-001](ADR-MEGA-001-001.md) | `ACCEPTED_PROVISIONAL` | PostgreSQL SQL migrations/no ORM and Node-managed authentication/session approach |

Repository-local ADRs do not convert a provisional architecture or security
choice into Gate B runtime proof. Their status must remain aligned with the
compact control state.
