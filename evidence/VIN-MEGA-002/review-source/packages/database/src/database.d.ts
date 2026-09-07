import { type QueryResultRow } from 'pg';
export type DatabaseConnectionOptions = {
    connectionString: string;
    applicationName: string;
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
export type Transaction = {
    query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<readonly Row[]>;
    execute(text: string, values?: readonly unknown[]): Promise<number>;
};
export type OutboxWorkerTransaction = {
    claimOutboxEvents(workerName: string, limit: number): Promise<readonly OutboxClaim[]>;
    markOutboxPublished(eventId: string, workerName: string): Promise<void>;
    markOutboxFailed(eventId: string, workerName: string, retryAt: Date | null): Promise<void>;
};
export declare class VinopsDatabase {
    private readonly pool;
    constructor(options: DatabaseConnectionOptions);
    withTransaction<T>(context: RequestDatabaseContext, operation: (transaction: Transaction) => Promise<T>): Promise<T>;
    withOutboxWorkerTransaction<T>(context: OutboxWorkerContext, operation: (transaction: OutboxWorkerTransaction) => Promise<T>): Promise<T>;
    lookupLoginUser(emailNormalized: string): Promise<LoginUserLookup | undefined>;
    lookupRefreshCredential(tokenHash: string): Promise<RefreshCredentialLookup | undefined>;
    lookupPasswordResetCredential(tokenHash: string): Promise<PasswordResetLookup | undefined>;
    close(): Promise<void>;
}
//# sourceMappingURL=database.d.ts.map