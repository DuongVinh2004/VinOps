import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function migration(name: string): Promise<string> {
  return readFile(path.join(packageRoot, 'migrations', name), 'utf8');
}

describe('PostgreSQL PKI digital signatures migration 017 design', () => {
  it('defines 6 PKI tables from ADR-015', async () => {
    const sql = await migration('017_pki_digital_signatures.sql');
    for (const table of [
      'signing_provider_configs',
      'user_signing_credentials',
      'signature_sessions',
      'digital_signatures',
      'as_built_dossiers',
      'dossier_items',
    ]) {
      expect(sql).toContain(`CREATE TABLE vinops.${table}`);
    }
  });

  it('enforces multi-tenant foreign keys, optimistic locking and prevent_delete triggers', async () => {
    const sql = await migration('017_pki_digital_signatures.sql');
    expect(sql).toContain(
      'FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)',
    );
    expect(sql).toContain('version bigint NOT NULL DEFAULT 1 CHECK (version > 0)');
    expect(sql).toContain('vinops.touch_updated_at()');
    expect(sql).toContain('vinops.increment_version()');
    expect(sql).toContain('vinops.prevent_delete()');
  });

  it('enforces RLS and tenant scoping on all 6 tables without bypass', async () => {
    const sql = await migration('017_pki_digital_signatures.sql');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain(
      'CREATE POLICY signing_provider_configs_tenant ON vinops.signing_provider_configs',
    );
    expect(sql).toContain(
      'CREATE POLICY user_signing_credentials_tenant ON vinops.user_signing_credentials',
    );
    expect(sql).toContain('CREATE POLICY signature_sessions_tenant ON vinops.signature_sessions');
    expect(sql).toContain('CREATE POLICY digital_signatures_tenant ON vinops.digital_signatures');
    expect(sql).toContain('CREATE POLICY as_built_dossiers_tenant ON vinops.as_built_dossiers');
    expect(sql).toContain('CREATE POLICY dossier_items_tenant ON vinops.dossier_items');
    expect(sql).toContain('vinops.can_access_project(project_id)');
    expect(sql).not.toContain('BYPASSRLS');
  });

  it('grants required permissions to vinops_app and vinops_worker roles', async () => {
    const sql = await migration('017_pki_digital_signatures.sql');
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE ON vinops.signing_provider_configs TO vinops_app',
    );
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE ON vinops.signature_sessions TO vinops_app',
    );
    expect(sql).toContain('GRANT SELECT, INSERT ON vinops.digital_signatures TO vinops_app');
    expect(sql).toContain(
      'GRANT SELECT ON vinops.signature_sessions, vinops.digital_signatures, vinops.signing_provider_configs, vinops.as_built_dossiers, vinops.dossier_items TO vinops_worker',
    );
  });
});
