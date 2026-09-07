import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export type DatabaseConnectionOptions = {
  connectionString: string;
  applicationName: string;
  runtimeRole: 'vinops_app' | 'vinops_worker';
};

export type RequestDatabaseContext = {
  actorUserId: string;
  correlationId?: string;
};

export type OutboxWorkerContext = {
  workerName: string;
  correlationId?: string;
};

export type LoginUserLookup = {
  id: string;
  password_hash: string;
  status: string;
  auth_version: string;
  authorization_version: string;
  display_name: string;
};

export type RefreshCredentialLookup = {
  credential_id: string;
  session_id: string;
  family_id: string;
  user_id: string;
  credential_expires_at: Date;
  credential_consumed_at: Date | null;
  credential_revoked_at: Date | null;
  session_status: string;
  family_status: string;
  family_idle_expires_at: Date;
  family_absolute_expires_at: Date;
  csrf_secret_hash: string;
  auth_version: string;
  authorization_version: string;
};

export type PasswordResetLookup = {
  credential_id: string;
  user_id: string;
  expires_at: Date;
  used_at: Date | null;
  status: string;
};

export type PasswordResetUserLookup = {
  id: string;
  email_normalized: string;
  status: string;
};

export type AcceptedInvitation = {
  membership_id: string;
  project_id: string;
  organization_id: string;
  roles: readonly string[];
  version: string;
};

export type OutboxClaim = {
  id: string;
  organization_id: string | null;
  project_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  publish_attempts: number;
};

export type FileProcessingClaim = {
  job_id: string;
  file_id: string;
  organization_id: string;
  project_id: string;
  job_type: 'validate_scan_preview' | 'reconcile';
  storage_bucket: string;
  quarantine_object_key: string;
  declared_size_bytes: string;
  declared_media_type: string;
  declared_sha256: string;
  original_filename: string;
  attempts: number;
};

export type CompleteFileProcessingInput = {
  jobId: string;
  fileId: string;
  workerName: string;
  result: 'Available' | 'Rejected' | 'Quarantined';
  failureCode: string | null;
  actualSizeBytes: number;
  actualSha256: string;
  detectedMediaType: string;
  availableObjectKey: string | null;
  scanEngine: string;
  signatureVersion: string;
  threatName: string | null;
  previewObjectKey: string | null;
  previewMediaType: string | null;
  previewSizeBytes: number | null;
  previewSha256: string | null;
};

export type CompleteFileReconciliationInput = {
  jobId: string;
  fileId: string;
  workerName: string;
  failureCode: string | null;
  actualSizeBytes: number | null;
  actualSha256: string | null;
};

export type Transaction = {
  query<Row extends QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<readonly Row[]>;
  execute(text: string, values?: readonly unknown[]): Promise<number>;
};

export type OutboxWorkerTransaction = {
  claimOutboxEvents(workerName: string, limit: number): Promise<readonly OutboxClaim[]>;
  markOutboxPublished(eventId: string, workerName: string): Promise<void>;
  markOutboxFailed(eventId: string, workerName: string, retryAt: Date | null): Promise<void>;
  claimFileProcessingJobs(
    workerName: string,
    limit: number,
  ): Promise<readonly FileProcessingClaim[]>;
  completeFileProcessing(input: CompleteFileProcessingInput): Promise<void>;
  completeFileReconciliation(input: CompleteFileReconciliationInput): Promise<void>;
  retryFileProcessingJob(
    jobId: string,
    workerName: string,
    errorCode: string,
    retryAt: Date | null,
  ): Promise<void>;
};

class PostgreSqlTransaction implements Transaction {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<readonly Row[]> {
    const result = await this.client.query<Row>(text, [...values]);
    return result.rows;
  }

  async execute(text: string, values: readonly unknown[] = []): Promise<number> {
    const result = await this.client.query(text, [...values]);
    return result.rowCount ?? 0;
  }
}

class PostgreSqlOutboxWorkerTransaction implements OutboxWorkerTransaction {
  constructor(private readonly client: PoolClient) {}

  async claimOutboxEvents(workerName: string, limit: number): Promise<readonly OutboxClaim[]> {
    const result = await this.client.query<OutboxClaim>(
      'SELECT * FROM vinops.claim_outbox_events($1, $2)',
      [workerName, limit],
    );
    return result.rows;
  }

  async markOutboxPublished(eventId: string, workerName: string): Promise<void> {
    await this.client.query('SELECT vinops.mark_outbox_published($1::uuid, $2)', [
      eventId,
      workerName,
    ]);
  }

  async markOutboxFailed(eventId: string, workerName: string, retryAt: Date | null): Promise<void> {
    await this.client.query('SELECT vinops.mark_outbox_failed($1::uuid, $2, $3::timestamptz)', [
      eventId,
      workerName,
      retryAt,
    ]);
  }

  async claimFileProcessingJobs(
    workerName: string,
    limit: number,
  ): Promise<readonly FileProcessingClaim[]> {
    const result = await this.client.query<FileProcessingClaim>(
      'SELECT * FROM vinops.claim_file_processing_jobs($1, $2)',
      [workerName, limit],
    );
    return result.rows;
  }

  async completeFileProcessing(input: CompleteFileProcessingInput): Promise<void> {
    await this.client.query(
      `SELECT vinops.complete_file_processing(
        $1::uuid, $2::uuid, $3, $4, $5, $6::bigint, $7::char(64), $8, $9,
        $10, $11, $12, $13, $14, $15::bigint, $16::char(64)
      )`,
      [
        input.jobId,
        input.fileId,
        input.workerName,
        input.result,
        input.failureCode,
        input.actualSizeBytes,
        input.actualSha256,
        input.detectedMediaType,
        input.availableObjectKey,
        input.scanEngine,
        input.signatureVersion,
        input.threatName,
        input.previewObjectKey,
        input.previewMediaType,
        input.previewSizeBytes,
        input.previewSha256,
      ],
    );
  }

  async completeFileReconciliation(input: CompleteFileReconciliationInput): Promise<void> {
    await this.client.query(
      `SELECT vinops.complete_file_reconciliation(
        $1::uuid, $2::uuid, $3, $4, $5::bigint, $6::char(64)
      )`,
      [
        input.jobId,
        input.fileId,
        input.workerName,
        input.failureCode,
        input.actualSizeBytes,
        input.actualSha256,
      ],
    );
  }

  async retryFileProcessingJob(
    jobId: string,
    workerName: string,
    errorCode: string,
    retryAt: Date | null,
  ): Promise<void> {
    await this.client.query(
      'SELECT vinops.retry_file_processing_job($1::uuid, $2, $3, $4::timestamptz)',
      [jobId, workerName, errorCode, retryAt],
    );
  }
}

export class VinopsDatabase {
  private readonly pool: Pool;
  private readonly runtimeRole: DatabaseConnectionOptions['runtimeRole'];

  constructor(options: DatabaseConnectionOptions) {
    this.runtimeRole = options.runtimeRole;
    this.pool = new Pool({
      connectionString: options.connectionString,
      application_name: options.applicationName,
      max: 12,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async withTransaction<T>(
    context: RequestDatabaseContext,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assumeRuntimeRole(client, 'vinops_app');
      await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
        context.actorUserId,
        context.correlationId ?? randomUUID(),
      ]);
      const result = await operation(new PostgreSqlTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async withOutboxWorkerTransaction<T>(
    context: OutboxWorkerContext,
    operation: (transaction: OutboxWorkerTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assumeRuntimeRole(client, 'vinops_worker');
      await client.query("SELECT set_config('app.correlation_id', $1, true)", [
        context.correlationId ?? randomUUID(),
      ]);
      const result = await operation(new PostgreSqlOutboxWorkerTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async lookupLoginUser(emailNormalized: string): Promise<LoginUserLookup | undefined> {
    return this.withAppRuntimeConnection(async (client) => {
      const result = await client.query<LoginUserLookup>(
        'SELECT * FROM vinops.lookup_user_for_login($1)',
        [emailNormalized],
      );
      return result.rows[0];
    });
  }

  async lookupRefreshCredential(tokenHash: string): Promise<RefreshCredentialLookup | undefined> {
    return this.withAppRuntimeConnection(async (client) => {
      const result = await client.query<RefreshCredentialLookup>(
        'SELECT * FROM vinops.lookup_refresh_credential($1::char(64))',
        [tokenHash],
      );
      return result.rows[0];
    });
  }

  async lookupPasswordResetCredential(tokenHash: string): Promise<PasswordResetLookup | undefined> {
    return this.withAppRuntimeConnection(async (client) => {
      const result = await client.query<PasswordResetLookup>(
        'SELECT * FROM vinops.lookup_password_reset_credential($1::char(64))',
        [tokenHash],
      );
      return result.rows[0];
    });
  }

  async lookupPasswordResetUser(
    emailNormalized: string,
  ): Promise<PasswordResetUserLookup | undefined> {
    return this.withAppRuntimeConnection(async (client) => {
      const result = await client.query<PasswordResetUserLookup>(
        'SELECT * FROM vinops.lookup_user_for_password_reset($1)',
        [emailNormalized],
      );
      return result.rows[0];
    });
  }

  async acceptProjectInvitation(
    tokenHash: string,
    userId: string,
    correlationId: string,
  ): Promise<AcceptedInvitation | undefined> {
    return this.withAppRuntimeConnection(async (client) => {
      const result = await client.query<AcceptedInvitation>(
        'SELECT * FROM vinops.accept_project_invitation($1::char(64), $2::uuid, $3::uuid)',
        [tokenHash, userId, correlationId],
      );
      return result.rows[0];
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async withAppRuntimeConnection<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assumeRuntimeRole(client, 'vinops_app');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assumeRuntimeRole(
    client: PoolClient,
    expectedRole: DatabaseConnectionOptions['runtimeRole'],
  ): Promise<void> {
    if (this.runtimeRole !== expectedRole) {
      throw new Error(
        `Database capability is configured for ${this.runtimeRole}, not ${expectedRole}.`,
      );
    }
    await client.query(
      expectedRole === 'vinops_app' ? 'SET LOCAL ROLE vinops_app' : 'SET LOCAL ROLE vinops_worker',
    );
    const role = await client.query<{ current_user: string }>('SELECT current_user');
    if (role.rows[0]?.current_user !== expectedRole) {
      throw new Error(`Unable to assume required ${expectedRole} database role.`);
    }
  }
}
