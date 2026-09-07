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
});
