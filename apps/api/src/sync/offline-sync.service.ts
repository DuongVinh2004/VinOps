import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase } from '@vinops/database';
import { resolveOfflineConflict, type OfflineOperationEnvelope } from '@vinops/domain';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';

@Injectable()
export class OfflineSyncService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-offline-sync-api',
            runtimeRole: 'vinops_app',
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  private requireDatabase(): VinopsDatabase {
    if (this.database === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.database;
  }

  async ingestBatch(
    identity: RequestIdentity,
    projectId: string,
    input: {
      device_id: string;
      operations: Array<{
        operation_id: string;
        entity_type: OfflineOperationEnvelope['entityType'];
        entity_temp_id: string;
        command: string;
        base_version: number;
        payload: Record<string, unknown>;
        payload_hash?: string;
        client_created_at: string;
        dependency_ids?: string[];
      }>;
    },
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const projectRes = await client.query<{ organization_id: string }>(
        'SELECT organization_id FROM vinops.projects WHERE id = $1',
        [projectId],
      );
      if (projectRes.length === 0) {
        throw new PlatformError('PROJECT_NOT_FOUND', 'errors.projectNotFound', 404, false);
      }
      const organizationId = projectRes[0]!.organization_id;

      const batchId = randomUUID();
      await client.query(
        `INSERT INTO vinops.sync_batches (
            id, organization_id, project_id, device_id, user_id, status, operation_count
          ) VALUES ($1, $2, $3, $4, $5, 'processing', $6)`,
        [
          batchId,
          organizationId,
          projectId,
          input.device_id,
          identity.userId,
          input.operations.length,
        ],
      );

      let appliedCount = 0;
      let conflictCount = 0;
      const opResults: Array<{
        operation_id: string;
        status: 'applied' | 'conflict' | 'rejected' | 'failed';
        canonical_id?: string;
        canonical_version?: number;
        error_code?: string;
        conflict_details?: Record<string, unknown>;
      }> = [];

      for (const op of input.operations) {
        try {
          // Find server entity if exists
          let serverEntity: {
            version: bigint;
            updatedAt: string;
            fields?: Record<string, unknown>;
          } | null = null;
          if (op.entity_type === 'daily_log') {
            const res = await client.query<{ version: string; updated_at: Date }>(
              'SELECT version, updated_at FROM vinops.daily_logs WHERE id = $1',
              [op.entity_temp_id],
            );
            if (res.length > 0) {
              serverEntity = {
                version: BigInt(res[0]!.version),
                updatedAt: res[0]!.updated_at.toISOString(),
              };
            }
          } else if (op.entity_type === 'inspection') {
            const res = await client.query<{ version: string; updated_at: Date }>(
              'SELECT version, updated_at FROM vinops.inspections WHERE id = $1',
              [op.entity_temp_id],
            );
            if (res.length > 0) {
              serverEntity = {
                version: BigInt(res[0]!.version),
                updatedAt: res[0]!.updated_at.toISOString(),
              };
            }
          }

          const envelope: OfflineOperationEnvelope = {
            operationId: op.operation_id,
            deviceId: input.device_id,
            entityType: op.entity_type,
            entityTempId: op.entity_temp_id,
            command: op.command,
            baseVersion: BigInt(op.base_version ?? 1),
            payload: op.payload,
            payloadHash: op.payload_hash ?? 'hash',
            clientCreatedAt: op.client_created_at,
            ...(op.dependency_ids ? { dependencyIds: op.dependency_ids } : {}),
          };

          const resolution = resolveOfflineConflict(envelope, serverEntity);

          if (resolution.action === 'apply_clean' || resolution.action === 'auto_merge') {
            // Apply operation
            const canonicalId = op.entity_temp_id.match(/^[0-9a-f-]{36}$/i)
              ? op.entity_temp_id
              : randomUUID();

            const baseVersion = op.base_version ?? 1;

            if (op.entity_type === 'daily_log' && op.command === 'create') {
              await client.query(
                `INSERT INTO vinops.daily_logs (
                    id, organization_id, project_id, contract_package_id, log_date, shift_code, status, author_unit, work_summary, notes, created_by
                  ) VALUES ($1, $2, $3, $4, $5, $6, 'Draft', $7, $8, $9, $10)
                  ON CONFLICT (id) DO NOTHING`,
                [
                  canonicalId,
                  organizationId,
                  projectId,
                  op.payload['contract_package_id'],
                  op.payload['log_date'],
                  op.payload['shift_code'] ?? 'day',
                  op.payload['author_unit'] ?? 'Chính',
                  op.payload['work_summary'] ?? '',
                  op.payload['notes'] ?? '',
                  identity.userId,
                ],
              );
            }

            await client.query(
              `INSERT INTO vinops.sync_operations (
                  id, batch_id, operation_id, entity_type, entity_temp_id, command, base_version, client_created_at, status, canonical_id, canonical_version
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'applied', $9, $10)`,
              [
                randomUUID(),
                batchId,
                op.operation_id,
                op.entity_type,
                op.entity_temp_id,
                op.command,
                baseVersion,
                op.client_created_at,
                canonicalId,
                baseVersion + 1,
              ],
            );

            appliedCount++;
            opResults.push({
              operation_id: op.operation_id,
              status: 'applied',
              canonical_id: canonicalId,
              canonical_version: baseVersion + 1,
            });
          } else {
            conflictCount++;
            const baseVersion = op.base_version ?? 1;
            await client.query(
              `INSERT INTO vinops.sync_operations (
                  id, batch_id, operation_id, entity_type, entity_temp_id, command, base_version, client_created_at, status, error_code, conflict_details
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'conflict', $9, $10)`,
              [
                randomUUID(),
                batchId,
                op.operation_id,
                op.entity_type,
                op.entity_temp_id,
                op.command,
                baseVersion,
                op.client_created_at,
                'CONFLICT',
                JSON.stringify(resolution, (_: string, v: unknown): unknown =>
                  typeof v === 'bigint' ? v.toString() : v,
                ),
              ],
            );

            opResults.push({
              operation_id: op.operation_id,
              status: 'conflict',
              error_code: 'CONFLICT',
              conflict_details: JSON.parse(
                JSON.stringify(resolution, (_: string, v: unknown): unknown =>
                  typeof v === 'bigint' ? v.toString() : v,
                ),
              ) as Record<string, unknown>,
            });
          }
        } catch (err: unknown) {
          conflictCount++;
          opResults.push({
            operation_id: op.operation_id,
            status: 'failed',
            error_code: err instanceof Error ? err.message : 'OPERATION_FAILED',
          });
        }
      }

      const finalStatus =
        conflictCount === 0 ? 'completed' : appliedCount > 0 ? 'partial_conflict' : 'failed';

      await client.query(
        `UPDATE vinops.sync_batches
              SET status = $2,
                  applied_count = $3,
                  conflict_count = $4,
                  finished_at = now()
            WHERE id = $1`,
        [batchId, finalStatus, appliedCount, conflictCount],
      );

      return {
        batch_id: batchId,
        status: finalStatus,
        operation_count: input.operations.length,
        applied_count: appliedCount,
        conflict_count: conflictCount,
        operations: opResults,
      };
    });
  }

  async getChanges(
    identity: RequestIdentity,
    projectId: string,
    cursor: string | undefined,
    correlationId: string,
  ): Promise<unknown> {
    const db = this.requireDatabase();
    return db.withTransaction({ actorUserId: identity.userId, correlationId }, async (client) => {
      const logs = await client.query<{ id: string; version: string; updated_at: Date }>(
        'SELECT id, version, updated_at FROM vinops.daily_logs WHERE project_id = $1 ORDER BY updated_at DESC LIMIT 50',
        [projectId],
      );
      const inspections = await client.query<{ id: string; version: string; updated_at: Date }>(
        'SELECT id, version, updated_at FROM vinops.inspections WHERE project_id = $1 ORDER BY updated_at DESC LIMIT 50',
        [projectId],
      );

      const changes = [
        ...logs.map((r) => ({
          entity_type: 'daily_log',
          entity_id: r.id,
          version: Number(r.version),
          action: 'upsert',
          data: { updated_at: r.updated_at },
        })),
        ...inspections.map((r) => ({
          entity_type: 'inspection',
          entity_id: r.id,
          version: Number(r.version),
          action: 'upsert',
          data: { updated_at: r.updated_at },
        })),
      ];

      return { changes, next_cursor: null };
    });
  }
}
