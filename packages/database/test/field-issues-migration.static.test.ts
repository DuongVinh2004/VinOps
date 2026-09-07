import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '012_field_issues_and_rfx.sql',
);

describe('VIN-MEGA-SLICE-B Field Issues, RFI, and Submittal migration design', () => {
  it('defines field issues, rfi requests, submittals and their supporting tables', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    for (const table of [
      'field_issues',
      'issue_attachments',
      'issue_comments',
      'rfi_requests',
      'rfi_responses',
      'submittals',
      'submittal_items',
      'submittal_reviews',
    ]) {
      expect(sql).toContain(`CREATE TABLE vinops.${table}`);
    }
    expect(sql).toContain('location_node_id uuid REFERENCES vinops.location_nodes(id)');
    expect(sql).toContain('work_node_id uuid REFERENCES vinops.work_nodes(id)');
    expect(sql).toContain('document_id uuid REFERENCES vinops.documents(id)');
    expect(sql).toContain('UNIQUE (project_id, code)');
  });

  it('enforces append-only / prevent_delete guards, concurrency versioning, and updated_at triggers', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('vinops.prevent_delete()');
    expect(sql).toContain('vinops.touch_updated_at()');
    expect(sql).toContain('vinops.increment_version()');
    expect(sql).toContain('field_issues_touch');
    expect(sql).toContain('rfi_requests_touch');
    expect(sql).toContain('submittals_touch');
    expect(sql).toContain('field_issues_version');
    expect(sql).toContain('rfi_requests_version');
    expect(sql).toContain('submittals_version');
  });

  it('configures row level security and contractor isolation policies without bypass', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('CREATE POLICY field_issues_scoped ON vinops.field_issues');
    expect(sql).toContain('CREATE POLICY rfi_requests_scoped ON vinops.rfi_requests');
    expect(sql).toContain('CREATE POLICY submittals_scoped ON vinops.submittals');
    expect(sql).toContain('vinops.user_partner_organization_id');
    expect(sql).toContain('vinops.is_project_supervisor');
    expect(sql).not.toContain('BYPASSRLS');
  });
});
