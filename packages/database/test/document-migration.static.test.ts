import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
  '007_document_control.sql',
);

describe('VIN-MEGA-002 Document Control migration design', () => {
  it('defines separate document, revision, technical file, explicit current, review and distribution records', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    for (const table of [
      'documents',
      'document_revisions',
      'revision_file_versions',
      'document_revision_current_files',
      'document_current_revisions',
      'file_objects',
      'upload_sessions',
      'file_scan_results',
      'file_derivatives',
      'revision_review_routes',
      'review_assignments',
      'review_comments',
      'review_comment_dispositions',
      'review_decisions',
      'annotations',
      'transmittals',
      'transmittal_items',
      'transmittal_recipients',
    ]) {
      expect(sql).toContain(`CREATE TABLE vinops.${table}`);
    }
    expect(sql).toContain('UNIQUE (project_id, numbering_context, code)');
    expect(sql).toContain('UNIQUE (document_id, revision_code)');
    expect(sql).toContain('PRIMARY KEY (document_id, context_key)');
    expect(sql).toContain('technical_version integer NOT NULL');
  });

  it('serializes atomic publish and protects append-only, sealed, quarantined and scoped data', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('CREATE FUNCTION vinops.publish_document_revision');
    expect(sql).toContain("status = 'Superseded'");
    expect(sql).toContain("'revision.published.v1'");
    expect(sql).toContain('TEST_FAILURE_BEFORE_COMMIT');
    expect(sql).toContain('APPEND_ONLY_HISTORY');
    expect(sql).toContain('SEALED_FILE_IMMUTABLE');
    expect(sql).toContain('TRANSMITTAL_SNAPSHOT_IMMUTABLE');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toContain('BYPASSRLS');
  });

  it('defines a fail-closed reconciliation contract and typed worker claims', async () => {
    const reconciliation = await readFile(
      path.resolve(path.dirname(migrationPath), '009_document_file_reconciliation.sql'),
      'utf8',
    );
    const typedClaim = await readFile(
      path.resolve(path.dirname(migrationPath), '010_file_job_type_claim.sql'),
      'utf8',
    );
    expect(reconciliation).toContain('complete_file_reconciliation');
    expect(reconciliation).toContain("status = 'Quarantined'");
    expect(reconciliation).not.toContain("status = 'Available'");
    expect(typedClaim).toContain('job_type text');
    expect(typedClaim).toContain("job.status IN ('Pending', 'Retry')");
  });

  it('breaks the transmittal policy dependency cycle without bypassing RLS', async () => {
    const rlsFix = await readFile(
      path.resolve(path.dirname(migrationPath), '011_transmittal_rls_recursion_fix.sql'),
      'utf8',
    );
    expect(rlsFix).toContain('DROP POLICY transmittal_items_scoped');
    expect(rlsFix).toContain('USING (vinops.can_access_project(project_id))');
    expect(rlsFix).not.toContain('FROM vinops.transmittals');
    expect(rlsFix).not.toContain('DISABLE ROW LEVEL SECURITY');
    expect(rlsFix).not.toContain('BYPASSRLS');
  });
});
