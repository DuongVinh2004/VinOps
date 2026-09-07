import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
class PostgreSqlTransaction {
    constructor(client) {
        this.client = client;
    }
    async query(text, values = []) {
        const result = await this.client.query(text, [...values]);
        return result.rows;
    }
    async execute(text, values = []) {
        const result = await this.client.query(text, [...values]);
        return result.rowCount ?? 0;
    }
}
class PostgreSqlOutboxWorkerTransaction {
    constructor(client) {
        this.client = client;
    }
    async claimOutboxEvents(workerName, limit) {
        const result = await this.client.query('SELECT * FROM vinops.claim_outbox_events($1, $2)', [workerName, limit]);
        return result.rows;
    }
    async markOutboxPublished(eventId, workerName) {
        await this.client.query('SELECT vinops.mark_outbox_published($1::uuid, $2)', [eventId, workerName]);
    }
    async markOutboxFailed(eventId, workerName, retryAt) {
        await this.client.query('SELECT vinops.mark_outbox_failed($1::uuid, $2, $3::timestamptz)', [
            eventId,
            workerName,
            retryAt,
        ]);
    }
}
export class VinopsDatabase {
    constructor(options) {
        this.pool = new Pool({
            connectionString: options.connectionString,
            application_name: options.applicationName,
            max: 12,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
        });
    }
    async withTransaction(context, operation) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT vinops.set_request_context($1::uuid, $2::uuid)', [
                context.actorUserId,
                context.correlationId ?? randomUUID(),
            ]);
            const result = await operation(new PostgreSqlTransaction(client));
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async withOutboxWorkerTransaction(context, operation) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const role = await client.query('SELECT current_user');
            if (role.rows[0]?.current_user !== 'vinops_worker') {
                throw new Error('VINOPS_DATABASE_URL must connect using the vinops_worker runtime role.');
            }
            await client.query("SELECT set_config('app.correlation_id', $1, true)", [
                context.correlationId ?? randomUUID(),
            ]);
            const result = await operation(new PostgreSqlOutboxWorkerTransaction(client));
            await client.query('COMMIT');
            return result;
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async lookupLoginUser(emailNormalized) {
        const result = await this.pool.query('SELECT * FROM vinops.lookup_user_for_login($1)', [emailNormalized]);
        return result.rows[0];
    }
    async lookupRefreshCredential(tokenHash) {
        const result = await this.pool.query('SELECT * FROM vinops.lookup_refresh_credential($1::char(64))', [tokenHash]);
        return result.rows[0];
    }
    async lookupPasswordResetCredential(tokenHash) {
        const result = await this.pool.query('SELECT * FROM vinops.lookup_password_reset_credential($1::char(64))', [tokenHash]);
        return result.rows[0];
    }
    async close() {
        await this.pool.end();
    }
}
//# sourceMappingURL=database.js.map