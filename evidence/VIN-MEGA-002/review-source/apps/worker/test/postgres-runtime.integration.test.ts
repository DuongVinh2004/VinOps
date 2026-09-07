import { randomUUID } from 'node:crypto';
import { VinopsDatabase } from '@vinops/database';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeterministicInProcessPublisher, type OutboxEvent } from '../src/outbox-publisher.js';
import { PostgreSqlOutboxStore } from '../src/postgres-outbox-store.js';
import { OutboxWorker } from '../src/outbox-worker.js';

const adminDatabaseUrl = process.env.VINOPS_TEST_WORKER_ADMIN_DATABASE_URL;
const workerDatabaseUrl = process.env.VINOPS_TEST_WORKER_DATABASE_URL;
const runtimeAvailable = adminDatabaseUrl !== undefined && workerDatabaseUrl !== undefined;
const runtimeDescribe = runtimeAvailable ? describe.sequential : describe.skip;

let verifier: Pool;
let databaseA: VinopsDatabase;
let databaseB: VinopsDatabase;
let storeA: PostgreSqlOutboxStore;
let storeB: PostgreSqlOutboxStore;

async function insertEvent(eventId: string): Promise<void> {
  await verifier.query(
    `INSERT INTO vinops.outbox_events (
       id, aggregate_type, aggregate_id, event_type, payload, status, available_at
     ) VALUES ($1::uuid, 'iteration4', $2::uuid, 'iteration4.probe',
       jsonb_build_object('correlation_id', $3::text), 'Pending', now())`,
    [eventId, randomUUID(), randomUUID()],
  );
}

beforeAll(() => {
  if (!runtimeAvailable) {
    return;
  }
  const databaseName = new URL(adminDatabaseUrl).pathname.replace(/^\//u, '');
  if (databaseName !== 'vinops_mega001_i4_worker_test') {
    throw new Error('Worker runtime integration requires its disposable Iteration 4 database.');
  }
  verifier = new Pool({ connectionString: adminDatabaseUrl, max: 2 });
  databaseA = new VinopsDatabase({
    connectionString: workerDatabaseUrl,
    applicationName: 'vinops-i4-worker-a',
    runtimeRole: 'vinops_worker',
  });
  databaseB = new VinopsDatabase({
    connectionString: workerDatabaseUrl,
    applicationName: 'vinops-i4-worker-b',
    runtimeRole: 'vinops_worker',
  });
  storeA = new PostgreSqlOutboxStore(databaseA);
  storeB = new PostgreSqlOutboxStore(databaseB);
});

afterAll(async () => {
  await Promise.all([databaseA?.close(), databaseB?.close()]);
  if (runtimeAvailable) {
    await verifier.end();
  }
});

runtimeDescribe('iteration-4 PostgreSQL outbox closure', () => {
  it('uses SKIP LOCKED for one-winner claims and denies generic tenant-table access', async () => {
    const eventId = randomUUID();
    await insertEvent(eventId);
    const [claimA, claimB] = await Promise.all([
      storeA.claim('i4-worker-a', 1, randomUUID()),
      storeB.claim('i4-worker-b', 1, randomUUID()),
    ]);
    expect(claimA.length + claimB.length).toBe(1);
    const winner = claimA[0] ?? claimB[0];
    expect(winner?.id).toBe(eventId);
    if (claimA.length === 1) {
      await storeA.markPublished(winner!, 'i4-worker-a');
    } else {
      await storeB.markPublished(winner!, 'i4-worker-b');
    }
    const state = await verifier.query<{ status: string; publish_attempts: number }>(
      `SELECT status, publish_attempts FROM vinops.outbox_events WHERE id = $1::uuid`,
      [eventId],
    );
    expect(state.rows[0]).toEqual({ status: 'Published', publish_attempts: 1 });

    const workerConnection = new Pool({ connectionString: workerDatabaseUrl, max: 1 });
    await expect(workerConnection.query('SELECT id FROM vinops.projects LIMIT 1')).rejects.toThrow(
      /permission denied/iu,
    );
    await workerConnection.end();
  });

  it('retries a failed publication once and deduplicates all later delivery', async () => {
    const eventId = randomUUID();
    await insertEvent(eventId);
    let invocations = 0;
    let captured: Readonly<OutboxEvent> | undefined;
    const handler = vi.fn((event: Readonly<OutboxEvent>) => {
      invocations += 1;
      captured = event;
      if (invocations === 1) {
        throw new Error('synthetic broker failure');
      }
    });
    const publisher = new DeterministicInProcessPublisher([handler]);
    const logger = { info: vi.fn(), error: vi.fn() };
    const worker = new OutboxWorker(storeA, publisher, logger, {
      workerName: 'i4-retry-worker',
      clock: () => new Date('2026-08-01T08:00:00.000Z'),
      correlationId: randomUUID,
    });

    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      published: 0,
      failed: 1,
      exhausted: 0,
    });
    const failed = await verifier.query<{ status: string; publish_attempts: number }>(
      `SELECT status, publish_attempts FROM vinops.outbox_events WHERE id = $1::uuid`,
      [eventId],
    );
    expect(failed.rows[0]).toEqual({ status: 'Pending', publish_attempts: 1 });

    await verifier.query(
      `UPDATE vinops.outbox_events SET available_at = now() WHERE id = $1::uuid`,
      [eventId],
    );
    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      published: 1,
      failed: 0,
      exhausted: 0,
    });
    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 0,
      published: 0,
      failed: 0,
      exhausted: 0,
    });
    expect(captured).toBeDefined();
    await publisher.publish(captured!);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(publisher.deliveries).toHaveLength(1);
    const published = await verifier.query<{ status: string; publish_attempts: number }>(
      `SELECT status, publish_attempts FROM vinops.outbox_events WHERE id = $1::uuid`,
      [eventId],
    );
    expect(published.rows[0]).toEqual({ status: 'Published', publish_attempts: 2 });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('synthetic broker failure');
  });
});
