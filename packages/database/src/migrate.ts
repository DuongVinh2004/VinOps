import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

export type AppliedMigration = {
  name: string;
  checksum: string;
};

function migrationDirectory(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDirectory, '..', 'migrations');
}

async function migrations(): Promise<readonly { name: string; sql: string; checksum: string }[]> {
  const directory = migrationDirectory();
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{3}_[a-z0-9_]+\.sql$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
  return Promise.all(
    entries.map(async (name) => {
      const sql = await readFile(path.join(directory, name), 'utf8');
      return {
        name,
        sql,
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
      };
    }),
  );
}

export async function verifyMigrations(
  connectionString: string,
): Promise<readonly AppliedMigration[]> {
  const pool = new Pool({ connectionString, application_name: 'vinops-migration-verify', max: 1 });
  try {
    const expected = await migrations();
    const appliedResult = await pool.query<AppliedMigration>(
      'SELECT name, checksum FROM vinops.schema_migrations ORDER BY name',
    );
    const applied = appliedResult.rows;
    if (applied.length !== expected.length) {
      throw new Error(
        `Migration verification expected ${expected.length} records, found ${applied.length}.`,
      );
    }
    for (const [index, migration] of expected.entries()) {
      const recorded = applied[index];
      if (recorded?.name !== migration.name || recorded.checksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch for ${migration.name}.`);
      }
    }
    const rlsResult = await pool.query<{ protected_tables: string }>(
      `SELECT count(*)::text AS protected_tables
         FROM pg_tables
        WHERE schemaname = 'vinops' AND rowsecurity`,
    );
    if (Number(rlsResult.rows[0]?.protected_tables ?? '0') < 36) {
      throw new Error('RLS verification found fewer protected foundation tables than expected.');
    }
    return applied;
  } finally {
    await pool.end();
  }
}

export async function runMigrations(
  connectionString: string,
): Promise<readonly AppliedMigration[]> {
  const pool = new Pool({ connectionString, application_name: 'vinops-migration-runner', max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('vinops:platform-foundation:migration'))",
    );
    await client.query('CREATE SCHEMA IF NOT EXISTS vinops');
    await client.query(`
      CREATE TABLE IF NOT EXISTS vinops.schema_migrations (
        name text PRIMARY KEY,
        checksum char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<AppliedMigration>(
      'SELECT name, checksum FROM vinops.schema_migrations ORDER BY name FOR UPDATE',
    );
    const appliedByName = new Map(applied.rows.map((migration) => [migration.name, migration]));
    const expected = await migrations();
    for (const migration of expected) {
      const recorded = appliedByName.get(migration.name);
      if (recorded !== undefined) {
        if (recorded.checksum !== migration.checksum) {
          throw new Error(`Refusing migration checksum drift for ${migration.name}.`);
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO vinops.schema_migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  return verifyMigrations(connectionString);
}

async function main(): Promise<void> {
  const connectionString = process.env.VINOPS_DATABASE_URL;
  if (connectionString === undefined || connectionString.trim().length === 0) {
    throw new Error('VINOPS_DATABASE_URL is required for PostgreSQL migrations.');
  }
  const verifyOnly = process.argv.includes('--verify');
  const result = verifyOnly
    ? await verifyMigrations(connectionString)
    : await runMigrations(connectionString);
  console.log(`${verifyOnly ? 'Verified' : 'Applied'} ${result.length} VinOps migration(s).`);
}

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  await main();
}
