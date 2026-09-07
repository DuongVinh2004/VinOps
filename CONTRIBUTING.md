# Contributing to VinOps

Thank you for your interest in contributing to **VinOps**, the open-standard Digital Engineering and Common Data Environment platform for mega capital infrastructure projects.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating in this community.

---

## 1. Development Prerequisites

Ensure your workstation satisfies the pinned platform toolchain:

- **Node.js**: `24.18.0` (Node 24 LTS)
- **Corepack & pnpm**: `11.15.1` (Strictly pinned, no global installation required)
- **Docker Engine & Docker Compose**: v2.20+ (for live PostgreSQL 17, MinIO S3, and ClamAV services)
- **Git**: 2.40+

Activate the exact package manager version using Corepack:

```bash
corepack enable
corepack prepare pnpm@11.15.1 --activate
```

---

## 2. Getting Started

1. **Fork and clone** the repository:

   ```bash
   git clone https://github.com/DuongVinh2004/VinOps.git
   cd VinOps/vinops
   ```

2. **Install dependencies** with frozen lockfile:

   ```bash
   pnpm install --frozen-lockfile
   ```

3. **Start local infrastructure**:

   ```bash
   docker compose up -d
   ```

4. **Run comprehensive verification**:
   ```bash
   pnpm verify
   ```

---

## 3. Branching & Commit Conventions

### Branch Naming

- Features: `feat/<feature-name>` (e.g., `feat/bcf-viewpoint-sync`)
- Bug fixes: `fix/<issue-description>` (e.g., `fix/pki-tsa-retry-timeout`)
- Documentation: `docs/<topic>` (e.g., `docs/adr-018-realtime`)

### Conventional Commits

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
<type>(<scope>): <short imperative summary>

[optional body explaining rationale and invariants]

[optional footer(s), e.g., Closes #123]
```

**Permitted Types**:

- `feat`: New user-facing capability or API feature
- `fix`: Bug fix in runtime or library
- `docs`: Documentation updates only
- `test`: Adding or refactoring tests
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `chore`: Build scripts, CI workflow, or dependency maintenance

---

## 4. Quality Gates & Local Verification

Before creating a Pull Request, you **must** ensure all automated foundation gates pass cleanly:

```bash
# Run all quality checks sequentially
pnpm verify
```

`pnpm verify` validates:

1. `pnpm format:check`: Code style conformity with Prettier
2. `pnpm lint`: Zero ESLint warnings or errors (`--max-warnings=0`)
3. `pnpm typecheck`: Strict TypeScript project reference verification across all 9 workspaces
4. `pnpm test`: Full Vitest regression suite across API, Worker, Web, and Database packages
5. `pnpm contracts:verify`: OpenAPI 3.1 schema linting and TypeScript contract synchronization
6. `pnpm architecture:check`: Dependency Cruiser cycle and layer boundary enforcement
7. `pnpm build`: Clean production compilation of all packages and client artifacts
8. `pnpm secret:scan`: Repository-wide high-entropy credential scanner
9. `pnpm license:check`: Strict direct-dependency license compliance audit

---

## 5. Submitting a Pull Request (PR)

1. Push your branch to your fork:
   ```bash
   git push origin feat/your-feature
   ```
2. Open a Pull Request against the `main` branch of `DuongVinh2004/VinOps`.
3. Complete all fields in the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).
4. Verify that CI passes on Linux and Windows runners.
5. Address review comments promptly. Once approved, maintainers will squash-and-merge your contribution.
