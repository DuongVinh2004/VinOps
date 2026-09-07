# Security Policy

## Supported Versions

VinOps maintains strict release and security patch lifecycles. Critical security vulnerabilities are patched promptly across the following versions:

| Version | Supported          | Security Maintenance Level   |
| ------- | ------------------ | ---------------------------- |
| 1.x     | :white_check_mark: | Active support & patches     |
| < 1.0   | :x:                | End of Life (Upgrade to 1.x) |

## Reporting a Vulnerability

We take the security and integrity of capital construction projects and electronic Common Data Environments (CDE) very seriously. If you discover a security vulnerability within VinOps, please follow our responsible disclosure process:

1. **Do NOT open a public GitHub issue** for security vulnerabilities or credential disclosures.
2. Email your findings directly to our security team: **security@vinops.dev** or file a confidential report via GitHub Private Vulnerability Reporting.
3. Include in your report:
   - Description of the vulnerability and attack vector (e.g., IDOR/BOLA, RLS bypass, CSRF, remote code execution).
   - Step-by-step reproduction steps or proof-of-concept (PoC).
   - Affected components (`apps/api`, `apps/worker`, `apps/web`, `packages/database`).
   - Potential business and tenant isolation impact.

### Response SLA

- **Initial Acknowledgment**: Within 24 hours.
- **Triage & Severity Assessment**: Within 48 hours.
- **Patch & Advisory Release**: Dependent on CVSS score (Critical/High: <= 7 calendar days).

## Security Architecture Guarantees

VinOps implements enterprise zero-trust security controls proven by automated regression suites:

- **Row-Level Security (RLS)**: Enforced directly inside PostgreSQL 17 at database kernel level. Tenants cannot read or mutate cross-organization data even if application queries omit tenant filters.
- **Least-Privilege Database Principals**: Runtime API connects as `vinops_app`, workers run as `vinops_worker`, while schema migrations run under an isolated administrative role.
- **Antivirus & Malware Pipeline**: Every uploaded file is placed in an isolated quarantine bucket in MinIO, scanned by ClamAV via `apps/worker`, and only promoted to clean storage once verified clean.
- **Credential & Secret Protection**: Passwords hashed with parameterized `scrypt`. Access tokens remain in memory; refresh credentials utilize `HttpOnly`, `SameSite=Strict`, `Secure` cookies with automatic refresh token family rotation and reuse detection.
- **Automated CI Secret Scanning**: Every pull request and build runs `pnpm secret:scan` rejecting high-entropy strings, RSA private keys, and cloud API tokens.
- **Cryptographic Audit Log**: Immutable append-only audit trail and PKI digital signature hash chains for electronic dossiers complying with NĐ 207/2026/NĐ-CP and RFC 3161 TSA.
