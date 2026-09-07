import { DomainError } from '../errors.js';

export type OfflineEntityType =
  | 'inspection'
  | 'inspection_result'
  | 'finding'
  | 'corrective_action'
  | 'daily_log'
  | 'daily_manpower'
  | 'daily_weather'
  | 'daily_equipment'
  | 'acceptance_record';

export type OfflineOperationEnvelope = {
  operationId: string;
  deviceId: string;
  entityType: OfflineEntityType;
  entityTempId: string;
  command: string;
  baseVersion: bigint;
  payload: Record<string, unknown>;
  payloadHash: string;
  clientCreatedAt: string; // ISO RFC3339
  dependencyIds?: readonly string[];
};

export type ConflictResolution =
  | { action: 'apply_clean' }
  | { action: 'auto_merge'; mergedFields: Record<string, unknown> }
  | { action: 'reject'; reason: 'server_authoritative' | 'stale_client_timestamp' }
  | {
      action: 'needs_resolution';
      serverVersion: bigint;
      serverUpdatedAt: string;
      clientTimestamp: string;
    };

const SERVER_AUTHORITATIVE_COMMANDS = new Set([
  'sign_contractor',
  'sign_supervisor',
  'sign_pmu',
  'confirm_log',
  'publish_template',
  'verify_car',
  'close_finding',
]);

/**
 * Evaluates offline mutation against current server entity version and timestamp.
 */
export function resolveOfflineConflict(
  operation: OfflineOperationEnvelope,
  serverEntity: { version: bigint; updatedAt: string; fields?: Record<string, unknown> } | null,
): ConflictResolution {
  // New entity draft creation offline
  if (serverEntity === null) {
    return { action: 'apply_clean' };
  }

  // Exact version match: fast path clean apply
  if (serverEntity.version === operation.baseVersion) {
    return { action: 'apply_clean' };
  }

  // Server authoritative commands cannot be applied out of order / offline version drift
  if (SERVER_AUTHORITATIVE_COMMANDS.has(operation.command)) {
    return { action: 'reject', reason: 'server_authoritative' };
  }

  // For checklist results or child daily logs: support non-conflicting item-level auto merge
  if (
    operation.entityType === 'inspection_result' ||
    operation.entityType === 'daily_manpower' ||
    operation.entityType === 'daily_weather' ||
    operation.entityType === 'daily_equipment'
  ) {
    return {
      action: 'auto_merge',
      mergedFields: { ...serverEntity.fields, ...operation.payload },
    };
  }

  // For concurrent entity edits: compare timestamps
  const clientTime = new Date(operation.clientCreatedAt).getTime();
  const serverTime = new Date(serverEntity.updatedAt).getTime();

  if (Number.isNaN(clientTime)) {
    throw new DomainError('INVALID_CLIENT_TIMESTAMP', 'Client timestamp is not a valid date.');
  }

  if (clientTime < serverTime) {
    // Client edit was based on an older state before server's newer update
    return {
      action: 'needs_resolution',
      serverVersion: serverEntity.version,
      serverUpdatedAt: serverEntity.updatedAt,
      clientTimestamp: operation.clientCreatedAt,
    };
  }

  return {
    action: 'auto_merge',
    mergedFields: { ...serverEntity.fields, ...operation.payload },
  };
}
