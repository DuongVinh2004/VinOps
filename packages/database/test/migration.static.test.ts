import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function migration(name: string): Promise<string> {
  return readFile(path.join(packageRoot, 'migrations', name), 'utf8');
}

describe('PostgreSQL platform migration design', () => {
  it('defines required tenant, IAM, Project Context, security, audit, outbox and idempotency tables', async () => {
    const sql = await migration('001_platform_foundation.sql');
    for (const table of [
      'users',
      'organizations',
      'organization_members',
      'projects',
      'project_members',
      'member_scopes',
      'invitations',
      'partner_organizations',
      'location_nodes',
      'work_nodes',
      'disciplines',
      'document_classifications',
      'project_calendars',
      'numbering_profiles',
      'numbering_counters',
      'auth_sessions',
      'refresh_token_families',
      'password_reset_credentials',
      'delegations',
      'break_glass_requests',
      'break_glass_sessions',
      'entity_transitions',
      'audit_events',
      'outbox_events',
      'idempotency_keys',
      'context_imports',
    ]) {
      expect(sql).toContain(`vinops.${table}`);
    }
    expect(sql).not.toContain('CREATE TABLE vinops.documents');
    expect(sql).not.toContain('CREATE TABLE vinops.issues');
  });

  it('uses UUID, timestamptz, bigint concurrency, immutable tenant placement and archival/no-delete guards', async () => {
    const sql = await migration('001_platform_foundation.sql');
    expect(sql).toContain('uuid PRIMARY KEY');
    expect(sql).toContain('timestamptz NOT NULL');
    expect(sql).toContain('version bigint NOT NULL DEFAULT 1');
    expect(sql).toContain('PROJECT_TENANT_IMMUTABLE');
    expect(sql).toContain('HARD_DELETE_FORBIDDEN');
    expect(sql).toContain('LOCATION_TREE_CYCLE');
    expect(sql).toContain('WORK_TREE_CYCLE');
  });

  it('uses restricted roles, transaction-local context and RLS policies without a general app bypass', async () => {
    const sql = await migration('002_tenant_rls.sql');
    expect(sql).toContain('CREATE ROLE vinops_app NOLOGIN');
    expect(sql).toContain('CREATE ROLE vinops_worker NOLOGIN');
    expect(sql).toContain("set_config('app.user_id'");
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('outbox_events_worker_or_project');
    expect(sql).toContain('can_read_scoped_resource');
    expect(sql).toContain('can_manage_project_context');
    expect(sql).toContain('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vinops FROM PUBLIC');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION vinops.current_actor_id() TO vinops_app');
    expect(sql).not.toContain('BYPASSRLS');
  });

  it('maintains strict sequential 001-014 migration files without duplicate numbers or gaps', async () => {
    const { readdir } = await import('node:fs/promises');
    const entries = (await readdir(path.join(packageRoot, 'migrations'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d{3}_[a-z0-9_]+\.sql$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'en'));

    expect(entries).toHaveLength(14);
    for (const [index, name] of entries.entries()) {
      const expectedPrefix = String(index + 1).padStart(3, '0');
      expect(name.startsWith(`${expectedPrefix}_`)).toBe(true);
    }
    expect(entries[entries.length - 1]).toBe('014_quality_inspection_and_field_records.sql');
  });

  it('defines quality inspection, daily logs and offline sync tables with RLS and no bypass in 014', async () => {
    const sql = await migration('014_quality_inspection_and_field_records.sql');
    for (const table of [
      'inspection_templates',
      'checklist_items',
      'inspections',
      'daily_logs',
      'sync_batches',
      'sync_operations',
    ]) {
      expect(sql).toContain(`vinops.${table}`);
    }
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('BYPASSRLS');
  });
});
