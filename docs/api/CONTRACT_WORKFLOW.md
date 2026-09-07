# API contract workflow

The repository OpenAPI document is a working copy of the OpenAPI v1 Candidate.
The external Candidate remains read-only and is not promoted by copying or
generating from it. PRSS and approved CRs take precedence over both copies.

CR-002 is approved as a contract baseline. It controls short-lived in-memory
Bearer access tokens, opaque rotating refresh credentials, the host-only
`vinops_refresh` cookie, session-bound CSRF protection, exact-origin CORS,
tenant-safe `404 RESOURCE_NOT_VISIBLE`, permission `403` behavior, and
`503 DEPENDENCY_UNAVAILABLE` problem details. Runtime/security proof remains
Gate B.

## Editing and generation

1. Confirm that the proposed contract change is authorized by PRSS or an
   approved CR. Raise a CR for semantic changes.
2. Edit the repository Candidate only; never overwrite the external source.
3. Reuse schemas, headers, and responses for `Set-Cookie`, 404, and 503 and apply
   them to relevant operations.
4. Lint, generate deterministically, and test drift.
5. Review the generated TypeScript for tenant visibility, credential leakage,
   nullability, error shape, and unexpected breaking changes.
6. Run the same typecheck, tests, license scan, and secret scan applied to
   hand-written code.

```text
corepack pnpm@11.15.1 run contracts:lint
corepack pnpm@11.15.1 run contracts:generate
corepack pnpm@11.15.1 run contracts:check
corepack pnpm@11.15.1 run typecheck
```

`contracts:check` must fail when committed generated output differs from fresh
generation. Generation must not create server business implementation, and a
green generator does not approve the contract.
