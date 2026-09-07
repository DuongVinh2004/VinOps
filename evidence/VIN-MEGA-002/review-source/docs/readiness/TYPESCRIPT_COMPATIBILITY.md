# TypeScript compatibility evidence

Checked against npm registry metadata on 2026-07-30. This record distinguishes
a version candidate from a completed repository compatibility proof.

| Candidate        | Peer gate                | Result     | Evidence/reason                                                                                                                                                                      |
| ---------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript 7.0.2 | strict pnpm peers        | `FAIL`     | `corepack pnpm@11.15.1 peers check` exited 1: installed 7.0.2, while `openapi-typescript@7.13.0` requires `typescript ^5.x` and `typescript-eslint@8.65.0` requires `>=4.8.4 <6.1.0` |
| TypeScript 6.0.3 | registry peer comparison | `EXCLUDED` | It satisfies the upper line admitted by `typescript-eslint`, but fails `openapi-typescript@7.13.0`'s `typescript ^5.x` peer requirement; no installation was retained                |
| TypeScript 5.9.3 | strict peer selection    | `PASS`     | Highest selected TypeScript 5 patch satisfying both recorded peer ranges; root manifest and lockfile pin exactly `5.9.3`; the full local matrix passed                               |

TypeScript 5.9.3 passed the repository matrix without `skipLibCheck`, reduced
strictness, or broad suppression:

| Check              | Required evidence                                       | Current state |
| ------------------ | ------------------------------------------------------- | ------------- |
| NestJS compile     | API and worker typecheck/build, decorators and metadata | `PASS`        |
| React/Vite         | web typecheck and production build                      | `PASS`        |
| Vitest             | assertion-bearing repository test run                   | `PASS`        |
| ESLint             | flat config and type-aware rules with zero warnings     | `PASS`        |
| OpenAPI            | lint, deterministic generation, and no-drift check      | `PASS`        |
| Project references | root recursive typecheck/build                          | `PASS`        |

Command evidence for every matrix row recorded exit code zero on 2026-07-30.
A later upgrade repeats the spike and requires an explicit dependency change;
it must not weaken checks to force a green result.
