import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApplication } from '../src/bootstrap.js';
import { createOpaqueCredential, hashCredential, hashPassword } from '../src/security.js';

import { runMigrations } from '../../../packages/database/src/migrate.js';

const adminUser = 'postgres';
const adminAuth = `${adminUser}:${adminUser}`;
const adminDatabaseUrl =
  process.env.VINOPS_TEST_DATABASE_URL ??
  `postgresql://${adminAuth}@127.0.0.1:5432/vinops_mega001_test`;

const appUser = 'vinops_app_user';
const appPass = 'fixture-vinops-password';
const appAuth = `${appUser}:${appPass}`;
const appDatabaseUrl =
  process.env.VINOPS_TEST_APP_DATABASE_URL ??
  `postgresql://${appAuth}@127.0.0.1:5432/vinops_mega001_test`;

const authSecret =
  process.env.VINOPS_TEST_AUTH_TOKEN_SECRET ?? 'fixture-auth-token-secret-0123456789012345';
const userPassword = process.env.VINOPS_TEST_USER_PASSWORD ?? 'fixture-user-password-12345';

const origin = 'http://127.0.0.1:4174';
const runtimeAvailable =
  adminDatabaseUrl !== undefined &&
  appDatabaseUrl !== undefined &&
  authSecret !== undefined &&
  userPassword !== undefined;
const runtimeDescribe = runtimeAvailable ? describe.sequential : describe.skip;
const suffix = randomUUID().slice(0, 8);

const ids = {
  admin: randomUUID(),
  secondAdmin: randomUUID(),
  sessionUser: randomUUID(),
  resetUser: randomUUID(),
  member: randomUUID(),
  concurrentMember: randomUUID(),
  guest: randomUUID(),
  organizationAdmin: randomUUID(),
  invitee: randomUUID(),
  expiredInvitee: randomUUID(),
  revokedInvitee: randomUUID(),
  outsider: randomUUID(),
  atomicUser: randomUUID(),
  organization: randomUUID(),
  project: randomUUID(),
  adminMembership: randomUUID(),
  secondAdminMembership: randomUUID(),
  memberMembership: randomUUID(),
  concurrentMembership: randomUUID(),
  guestMembership: randomUUID(),
  locationAllowed: randomUUID(),
  locationDenied: randomUUID(),
  workAllowed: randomUUID(),
} as const;

const emails = {
  admin: `i4-admin-${suffix}@vinops.test`,
  secondAdmin: `i4-second-admin-${suffix}@vinops.test`,
  sessionUser: `i4-session-${suffix}@vinops.test`,
  resetUser: `i4-reset-${suffix}@vinops.test`,
  member: `i4-member-${suffix}@vinops.test`,
  concurrentMember: `i4-concurrent-${suffix}@vinops.test`,
  guest: `i4-guest-${suffix}@vinops.test`,
  organizationAdmin: `i4-org-admin-${suffix}@vinops.test`,
  invitee: `i4-invitee-${suffix}@vinops.test`,
  expiredInvitee: `i4-expired-${suffix}@vinops.test`,
  revokedInvitee: `i4-revoked-${suffix}@vinops.test`,
  outsider: `i4-outsider-${suffix}@vinops.test`,
  atomicUser: `i4-atomic-${suffix}@vinops.test`,
} as const;

type Session = {
  accessToken: string;
  csrfToken: string;
  refreshCookie: string;
  sessionId: string;
};

let app: INestApplication | undefined;
let server: Server;
let verifier: Pool;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }
  return value as Record<string, unknown>;
}

function refreshCookie(response: Response): string {
  const headers = response.headers as Record<string, unknown>;
  const value = headers['set-cookie'];
  let header: unknown = value;
  if (Array.isArray(value)) {
    [header] = value as unknown[];
  }
  if (typeof header !== 'string') {
    throw new Error('Expected refresh cookie.');
  }
  const cookie = header.split(';', 1)[0];
  if (cookie === undefined || !cookie.startsWith('vinops_refresh=')) {
    throw new Error('Expected VinOps refresh cookie.');
  }
  return cookie;
}

async function login(email: string, password = userPassword): Promise<Session> {
  const response = await request(server)
    .post('/api/v1/auth/sessions')
    .send({ email, password, device_name: 'i4-runtime' })
    .expect(200);
  const body = record(response.body);
  return {
    accessToken: String(body.access_token),
    csrfToken: String(body.csrf_token),
    refreshCookie: refreshCookie(response),
    sessionId: String(body.session_id),
  };
}

function bearer(token: string): string {
  return `Bearer ${token}`;
}

async function insertInvitation(input: {
  userId: string;
  email: string;
  token: string;
  status?: 'Pending' | 'Revoked';
  expired?: boolean;
}): Promise<string> {
  const invitationId = randomUUID();
  const createdAt = input.expired ? new Date(Date.now() - 2 * 60 * 60_000) : new Date();
  const expiresAt = input.expired
    ? new Date(Date.now() - 60 * 60_000)
    : new Date(Date.now() + 60 * 60_000);
  await verifier.query(
    `INSERT INTO vinops.invitations (
       id, organization_id, project_id, email_normalized, token_hash, roles, scopes,
       status, expires_at, created_by, created_at
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, ARRAY['project_member'], '[]'::jsonb,
       $6, $7::timestamptz, $8::uuid, $9::timestamptz)`,
    [
      invitationId,
      ids.organization,
      ids.project,
      input.email,
      hashCredential(input.token),
      input.status ?? 'Pending',
      expiresAt,
      ids.admin,
      createdAt,
    ],
  );
  return invitationId;
}

beforeAll(async () => {
  if (!runtimeAvailable) {
    return;
  }
  const databaseName = new URL(adminDatabaseUrl).pathname.replace(/^\//u, '');
  if (databaseName !== 'vinops_mega001_test') {
    throw new Error('Runtime security integration requires vinops_mega001_test.');
  }
  await runMigrations(adminDatabaseUrl);
  verifier = new Pool({ connectionString: adminDatabaseUrl, max: 4 });
  const passwordHash = await hashPassword(userPassword);
  const users = [
    [ids.admin, emails.admin, 'I4 Admin'],
    [ids.secondAdmin, emails.secondAdmin, 'I4 Second Admin'],
    [ids.sessionUser, emails.sessionUser, 'I4 Session User'],
    [ids.resetUser, emails.resetUser, 'I4 Reset User'],
    [ids.member, emails.member, 'I4 Member'],
    [ids.concurrentMember, emails.concurrentMember, 'I4 Concurrent Member'],
    [ids.guest, emails.guest, 'I4 Guest'],
    [ids.organizationAdmin, emails.organizationAdmin, 'I4 Organization Admin'],
    [ids.invitee, emails.invitee, 'I4 Invitee'],
    [ids.expiredInvitee, emails.expiredInvitee, 'I4 Expired Invitee'],
    [ids.revokedInvitee, emails.revokedInvitee, 'I4 Revoked Invitee'],
    [ids.outsider, emails.outsider, 'I4 Outsider'],
    [ids.atomicUser, emails.atomicUser, 'I4 Atomic User'],
  ] as const;
  for (const [id, email, displayName] of users) {
    await verifier.query(
      `INSERT INTO vinops.users (id, email_normalized, display_name, password_hash)
       VALUES ($1::uuid, $2, $3, $4)`,
      [id, email, displayName, passwordHash],
    );
  }
  await verifier.query(
    `INSERT INTO vinops.platform_entitlements (id, user_id, capability, granted_by)
     VALUES ($1::uuid, $2::uuid, 'organization_create', 'iteration-4'),
            ($3::uuid, $4::uuid, 'organization_create', 'iteration-4')`,
    [randomUUID(), ids.admin, randomUUID(), ids.atomicUser],
  );
  await verifier.query(
    `INSERT INTO vinops.organizations (id, code, name, created_by)
     VALUES ($1::uuid, $2, 'I4 Security Organization', $3::uuid)`,
    [ids.organization, `I4${suffix.toUpperCase()}`, ids.admin],
  );
  await verifier.query(
    `INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status, valid_from)
     VALUES
       ($1::uuid, $2::uuid, $3::uuid, ARRAY['organization_owner'], 'Active', now()),
       ($4::uuid, $2::uuid, $5::uuid, ARRAY['organization_admin'], 'Active', now())`,
    [randomUUID(), ids.organization, ids.admin, randomUUID(), ids.organizationAdmin],
  );
  await verifier.query(
    `INSERT INTO vinops.projects (id, organization_id, code, name, timezone, status, created_by)
     VALUES ($1::uuid, $2::uuid, $3, 'I4 Security Project', 'Asia/Bangkok', 'Active', $4::uuid)`,
    [ids.project, ids.organization, `I4P${suffix.toUpperCase()}`, ids.admin],
  );
  const memberships = [
    [ids.adminMembership, ids.admin, ['project_admin']],
    [ids.secondAdminMembership, ids.secondAdmin, ['project_admin']],
    [ids.memberMembership, ids.member, ['project_member']],
    [ids.concurrentMembership, ids.concurrentMember, ['project_member']],
    [ids.guestMembership, ids.guest, ['project_guest']],
    [randomUUID(), ids.atomicUser, ['project_member']],
  ] as const;
  for (const [membershipId, userId, roles] of memberships) {
    await verifier.query(
      `INSERT INTO vinops.project_members (
         id, organization_id, project_id, user_id, roles, status, valid_from
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text[], 'Active', now())`,
      [membershipId, ids.organization, ids.project, userId, [...roles]],
    );
  }
  await verifier.query(
    `INSERT INTO vinops.location_nodes (
       id, organization_id, project_id, code, name, node_type, created_by
     ) VALUES
       ($1::uuid, $2::uuid, $3::uuid, 'I4-L1', 'Allowed Location', 'zone', $4::uuid),
       ($5::uuid, $2::uuid, $3::uuid, 'I4-L2', 'Denied Location', 'zone', $4::uuid)`,
    [ids.locationAllowed, ids.organization, ids.project, ids.admin, ids.locationDenied],
  );
  await verifier.query(
    `INSERT INTO vinops.work_nodes (
       id, organization_id, project_id, location_node_id, code, name, node_type, created_by
     ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'I4-W1', 'Allowed Work', 'work_package', $5::uuid)`,
    [ids.workAllowed, ids.organization, ids.project, ids.locationAllowed, ids.admin],
  );
  await verifier.query(
    `INSERT INTO vinops.member_scopes (
       id, organization_id, project_id, project_member_id, scope_type, scope_id, actions
     ) VALUES
       ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'location', $5::uuid, ARRAY['read']),
       ($6::uuid, $2::uuid, $3::uuid, $4::uuid, 'work', $7::uuid, ARRAY['read'])`,
    [
      randomUUID(),
      ids.organization,
      ids.project,
      ids.guestMembership,
      ids.locationAllowed,
      randomUUID(),
      ids.workAllowed,
    ],
  );
  await verifier.query(`
    CREATE OR REPLACE FUNCTION vinops.i4_atomic_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.action = 'organization.created'
         AND NEW.actor_user_id = '${ids.atomicUser}'::uuid THEN
        RAISE EXCEPTION 'I4_ATOMIC_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS i4_atomic_failure ON vinops.audit_events;
    CREATE TRIGGER i4_atomic_failure BEFORE INSERT ON vinops.audit_events
      FOR EACH ROW EXECUTE FUNCTION vinops.i4_atomic_failure();
  `);
  ({ app } = await createApiApplication({
    NODE_ENV: 'test',
    VINOPS_LOG_LEVEL: 'silent',
    VINOPS_API_HOST: '127.0.0.1',
    VINOPS_API_PORT: '3000',
    VINOPS_DATABASE_URL: appDatabaseUrl,
    VINOPS_AUTH_TOKEN_SECRET: authSecret,
    VINOPS_ALLOWED_ORIGINS: origin,
    VINOPS_ACCESS_TOKEN_TTL_SECONDS: '900',
    VINOPS_REFRESH_IDLE_TTL_DAYS: '7',
    VINOPS_REFRESH_ABSOLUTE_TTL_DAYS: '30',
    VINOPS_AUTH_RATE_LIMIT_WINDOW_SECONDS: '900',
    VINOPS_AUTH_RATE_LIMIT_MAX_ATTEMPTS: '100',
    VINOPS_REFRESH_COOKIE_SECURE: 'false',
  }));
  await app.init();
  server = app.getHttpServer() as Server;
}, 30_000);

afterAll(async () => {
  await app?.close();
  if (runtimeAvailable) {
    await verifier.end();
  }
});

runtimeDescribe('iteration-4 live security and consistency closure', () => {
  it('detects refresh reuse, scopes revoke-one/revoke-all, and consumes reset tokens once', async () => {
    const rotating = await login(emails.sessionUser);
    const rotatedResponse = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotating.refreshCookie)
      .set('x-csrf-token', rotating.csrfToken)
      .set('Origin', origin)
      .expect(200);
    const rotatedBody = record(rotatedResponse.body);
    const rotatedCookie = refreshCookie(rotatedResponse);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotating.refreshCookie)
      .set('x-csrf-token', rotating.csrfToken)
      .set('Origin', origin)
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotatedCookie)
      .set('x-csrf-token', String(rotatedBody.csrf_token))
      .set('Origin', origin)
      .expect(401);
    const reuse = await verifier.query<{ status: string; detected: boolean }>(
      `SELECT status, reuse_detected_at IS NOT NULL AS detected
         FROM vinops.refresh_token_families WHERE user_id = $1::uuid
         ORDER BY created_at DESC LIMIT 1`,
      [ids.sessionUser],
    );
    expect(reuse.rows[0]).toEqual({ status: 'Revoked', detected: true });

    const sessionA = await login(emails.sessionUser);
    const sessionB = await login(emails.sessionUser);
    await request(server)
      .delete(`/api/v1/auth/sessions/${sessionA.sessionId}`)
      .set('Authorization', bearer(sessionB.accessToken))
      .expect(204);
    await request(server)
      .get('/api/v1/organizations')
      .set('Authorization', bearer(sessionA.accessToken))
      .expect(401);
    await request(server)
      .get('/api/v1/organizations')
      .set('Authorization', bearer(sessionB.accessToken))
      .expect(200);
    const sessionC = await login(emails.sessionUser);
    await request(server)
      .delete('/api/v1/auth/sessions')
      .set('Authorization', bearer(sessionB.accessToken))
      .expect(204);
    for (const token of [sessionB.accessToken, sessionC.accessToken]) {
      await request(server)
        .get('/api/v1/organizations')
        .set('Authorization', bearer(token))
        .expect(401);
    }

    const csrfSession = await login(emails.sessionUser);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', csrfSession.refreshCookie)
      .set('x-csrf-token', 'invalid-csrf')
      .set('Origin', origin)
      .expect(401);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', csrfSession.refreshCookie)
      .set('x-csrf-token', csrfSession.csrfToken)
      .set('Origin', 'http://not-allowed.invalid')
      .expect(403);

    const existingReset = await request(server)
      .post('/api/v1/auth/password-resets')
      .send({ email: emails.resetUser })
      .expect(202);
    const missingReset = await request(server)
      .post('/api/v1/auth/password-resets')
      .send({ email: `missing-${suffix}@vinops.test` })
      .expect(202);
    expect(existingReset.body).toEqual(missingReset.body);
    const resetToken = createOpaqueCredential();
    await verifier.query(
      `INSERT INTO vinops.password_reset_credentials (id, user_id, token_hash, expires_at)
       VALUES ($1::uuid, $2::uuid, $3, now() + interval '30 minutes')`,
      [randomUUID(), ids.resetUser, hashCredential(resetToken)],
    );
    const nextPassword = `${userPassword}-rotated`;
    await request(server)
      .post('/api/v1/auth/password-resets/confirm')
      .send({ token: resetToken, password: nextPassword })
      .expect(204);
    await request(server)
      .post('/api/v1/auth/password-resets/confirm')
      .send({ token: resetToken, password: nextPassword })
      .expect(401);
    await login(emails.resetUser, nextPassword);
  });

  it('enforces invitations, immediate membership revocation, resource scope, and non-disclosure', async () => {
    const admin = await login(emails.admin);
    const invitee = await login(emails.invitee);
    await request(server)
      .get(`/api/v1/projects/${ids.project}`)
      .set('Authorization', bearer(invitee.accessToken))
      .expect(404);
    const inviteToken = createOpaqueCredential();
    await insertInvitation({ userId: ids.invitee, email: emails.invitee, token: inviteToken });
    await request(server)
      .post(`/api/v1/invitations/${inviteToken}/accept`)
      .set('Authorization', bearer(invitee.accessToken))
      .expect(200);
    await request(server)
      .get(`/api/v1/projects/${ids.project}`)
      .set('Authorization', bearer(invitee.accessToken))
      .expect(200);

    const expiredToken = createOpaqueCredential();
    await insertInvitation({
      userId: ids.expiredInvitee,
      email: emails.expiredInvitee,
      token: expiredToken,
      expired: true,
    });
    const expiredUser = await login(emails.expiredInvitee);
    await request(server)
      .post(`/api/v1/invitations/${expiredToken}/accept`)
      .set('Authorization', bearer(expiredUser.accessToken))
      .expect(422);
    const revokedToken = createOpaqueCredential();
    await insertInvitation({
      userId: ids.revokedInvitee,
      email: emails.revokedInvitee,
      token: revokedToken,
      status: 'Revoked',
    });
    const revokedUser = await login(emails.revokedInvitee);
    await request(server)
      .post(`/api/v1/invitations/${revokedToken}/accept`)
      .set('Authorization', bearer(revokedUser.accessToken))
      .expect(422);

    const member = await login(emails.member);
    await request(server)
      .get(`/api/v1/projects/${ids.project}`)
      .set('Authorization', bearer(member.accessToken))
      .expect(200);
    const suspended = await request(server)
      .patch(`/api/v1/project-members/${ids.memberMembership}`)
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', `i4-suspend-${suffix}`)
      .send({ status: 'Suspended', expected_version: '1', reason: 'Iteration 4 proof' })
      .expect(200);
    expect(record(suspended.body).status).toBe('Suspended');
    await request(server)
      .get(`/api/v1/projects/${ids.project}`)
      .set('Authorization', bearer(member.accessToken))
      .expect(401);
    const memberAfterSuspension = await login(emails.member);
    await request(server)
      .get(`/api/v1/projects/${ids.project}`)
      .set('Authorization', bearer(memberAfterSuspension.accessToken))
      .expect(404);
    await request(server)
      .patch(`/api/v1/project-members/${ids.memberMembership}`)
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', `i4-end-${suffix}`)
      .send({ status: 'Ended', expected_version: '2', reason: 'Iteration 4 proof' })
      .expect(200);

    await request(server)
      .patch(`/api/v1/project-members/${ids.adminMembership}`)
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', `i4-self-escalate-${suffix}`)
      .send({ roles: ['project_admin'], expected_version: '1' })
      .expect(403);

    const organizationAdmin = await login(emails.organizationAdmin);
    await request(server)
      .get(`/api/v1/projects/${ids.project}`)
      .set('Authorization', bearer(organizationAdmin.accessToken))
      .expect(404);
    const guest = await login(emails.guest);
    const contextResponse = await request(server)
      .get(`/api/v1/projects/${ids.project}/context`)
      .set('Authorization', bearer(guest.accessToken))
      .expect(200);
    const context = record(contextResponse.body);
    expect(context.location_nodes).toMatchObject([{ id: ids.locationAllowed }]);
    expect(JSON.stringify(context.location_nodes)).not.toContain(ids.locationDenied);
    expect(context.work_nodes).toMatchObject([{ id: ids.workAllowed }]);
    await request(server)
      .post(`/api/v1/projects/${ids.project}/context/location_node`)
      .set('Authorization', bearer(guest.accessToken))
      .set('Idempotency-Key', `i4-guest-write-${suffix}`)
      .send({ code: 'DENIED', name: 'Denied', node_type: 'zone' })
      .expect(403);
    const outsider = await login(emails.outsider);
    for (const target of [ids.project, randomUUID()]) {
      await request(server)
        .get(`/api/v1/projects/${target}`)
        .set('Authorization', bearer(outsider.accessToken))
        .expect(404);
    }
  });

  it('gives concurrent writes one winner, enforces idempotency, and rolls entity/audit/outbox back atomically', async () => {
    const admin = await login(emails.admin);
    const concurrent = await Promise.all([
      request(server)
        .patch(`/api/v1/project-members/${ids.concurrentMembership}`)
        .set('Authorization', bearer(admin.accessToken))
        .set('Idempotency-Key', `i4-concurrent-a-${suffix}`)
        .send({ roles: ['project_member'], expected_version: '1' }),
      request(server)
        .patch(`/api/v1/project-members/${ids.concurrentMembership}`)
        .set('Authorization', bearer(admin.accessToken))
        .set('Idempotency-Key', `i4-concurrent-b-${suffix}`)
        .send({ roles: ['project_guest'], expected_version: '1' }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    const concurrentState = await verifier.query<{ version: string }>(
      `SELECT version::text FROM vinops.project_members WHERE id = $1::uuid`,
      [ids.concurrentMembership],
    );
    expect(concurrentState.rows[0]?.version).toBe('2');
    const concurrentEffects = await verifier.query<{ audits: string; events: string }>(
      `SELECT
        (SELECT count(*)::text FROM vinops.audit_events WHERE entity_id = $1::uuid AND action = 'project_membership.updated') AS audits,
        (SELECT count(*)::text FROM vinops.outbox_events WHERE aggregate_id = $1::uuid AND event_type LIKE 'project_membership.%') AS events`,
      [ids.concurrentMembership],
    );
    expect(concurrentEffects.rows[0]).toEqual({ audits: '1', events: '1' });

    const key = `i4-idempotency-${suffix}`;
    const organizationPayload = { code: `ID${suffix}`, name: 'I4 Idempotent Organization' };
    const first = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', key)
      .send(organizationPayload)
      .expect(201);
    const replay = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', key)
      .send(organizationPayload)
      .expect(201);
    expect(record(replay.body).id).toBe(record(first.body).id);
    const createdOrganizationId = String(record(first.body).id);
    const effects = await verifier.query<{ organizations: string; audits: string; events: string }>(
      `SELECT
        (SELECT count(*)::text FROM vinops.organizations WHERE id = $1::uuid) AS organizations,
        (SELECT count(*)::text FROM vinops.audit_events WHERE entity_id = $1::uuid AND action = 'organization.created') AS audits,
        (SELECT count(*)::text FROM vinops.outbox_events WHERE aggregate_id = $1::uuid AND event_type = 'organization.created') AS events`,
      [createdOrganizationId],
    );
    expect(effects.rows[0]).toEqual({ organizations: '1', audits: '1', events: '1' });
    const reuse = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', key)
      .send({ ...organizationPayload, name: 'Different Payload' })
      .expect(409);
    expect(record(reuse.body).code).toBe('IDEMPOTENCY_KEY_REUSE');
    const denialAudit = await verifier.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vinops.audit_events
        WHERE actor_user_id = $1::uuid AND action = 'idempotency.key_reuse_denied'`,
      [ids.admin],
    );
    expect(denialAudit.rows[0]?.count).toBe('1');

    const atomic = await login(emails.atomicUser);
    const outboxBefore = await verifier.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vinops.outbox_events`,
    );
    const atomicCode = `AT${suffix}`;
    await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', bearer(atomic.accessToken))
      .set('Idempotency-Key', `i4-atomic-${suffix}`)
      .send({ code: atomicCode, name: 'Must Roll Back' })
      .expect(500);
    const rollback = await verifier.query<{
      organizations: string;
      audits: string;
      outbox: string;
    }>(
      `SELECT
        (SELECT count(*)::text FROM vinops.organizations WHERE code = $1) AS organizations,
        (SELECT count(*)::text FROM vinops.audit_events WHERE actor_user_id = $2::uuid AND action = 'organization.created') AS audits,
        (SELECT count(*)::text FROM vinops.outbox_events) AS outbox`,
      [atomicCode, ids.atomicUser],
    );
    expect(rollback.rows[0]).toEqual({
      organizations: '0',
      audits: '0',
      outbox: outboxBefore.rows[0]?.count,
    });
  });

  it('enforces delegation expiry and break-glass separation, TTL, audit, and non-elevation', async () => {
    const admin = await login(emails.admin);
    const secondAdmin = await login(emails.secondAdmin);
    const requester = await login(emails.concurrentMember);
    const validFrom = new Date(Date.now() - 60_000).toISOString();
    const validTo = new Date(Date.now() + 30 * 60_000).toISOString();
    const delegation = await request(server)
      .post(`/api/v1/projects/${ids.project}/delegations`)
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', `i4-delegation-${suffix}`)
      .send({
        delegatee_user_id: ids.concurrentMember,
        scope_type: 'project',
        scope_id: ids.project,
        actions: ['read'],
        valid_from: validFrom,
        valid_to: validTo,
        reason: 'Iteration 4 bounded delegation',
      })
      .expect(201);
    const delegationId = String(record(delegation.body).id);
    await request(server)
      .post(`/api/v1/projects/${ids.project}/delegations`)
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', `i4-self-delegation-${suffix}`)
      .send({
        delegatee_user_id: ids.admin,
        scope_type: 'project',
        scope_id: ids.project,
        actions: ['read'],
        valid_from: validFrom,
        valid_to: validTo,
        reason: 'Forbidden self delegation',
      })
      .expect(403);
    await request(server)
      .post(`/api/v1/projects/${ids.project}/delegations`)
      .set('Authorization', bearer(admin.accessToken))
      .set('Idempotency-Key', `i4-expired-delegation-${suffix}`)
      .send({
        delegatee_user_id: ids.concurrentMember,
        scope_type: 'project',
        scope_id: ids.project,
        actions: ['read'],
        valid_from: new Date(Date.now() - 120_000).toISOString(),
        valid_to: new Date(Date.now() - 60_000).toISOString(),
        reason: 'Expired delegation',
      })
      .expect(403);
    await verifier.query(
      `UPDATE vinops.delegations SET status = 'Revoked', revoked_at = now()
        WHERE id = $1::uuid AND status = 'Active'`,
      [delegationId],
    );
    const revoked = await verifier.query<{ status: string; revoked: boolean }>(
      `SELECT status, revoked_at IS NOT NULL AS revoked FROM vinops.delegations WHERE id = $1::uuid`,
      [delegationId],
    );
    expect(revoked.rows[0]).toEqual({ status: 'Revoked', revoked: true });

    await request(server)
      .post(`/api/v1/projects/${ids.project}/break-glass-requests`)
      .set('Authorization', bearer(requester.accessToken))
      .set('Idempotency-Key', `i4-break-glass-ttl-${suffix}`)
      .send({
        scope_type: 'project',
        scope_id: ids.project,
        actions: ['read'],
        reason: 'TTL must be bounded',
        valid_from: validFrom,
        valid_to: new Date(Date.now() + 5 * 60 * 60_000).toISOString(),
      })
      .expect(422);
    const breakGlass = await request(server)
      .post(`/api/v1/projects/${ids.project}/break-glass-requests`)
      .set('Authorization', bearer(requester.accessToken))
      .set('Idempotency-Key', `i4-break-glass-${suffix}`)
      .send({
        scope_type: 'project',
        scope_id: ids.project,
        actions: ['read'],
        reason: 'Iteration 4 emergency read proof',
        valid_from: validFrom,
        valid_to: validTo,
      })
      .expect(201);
    const requestId = String(record(breakGlass.body).id);
    await request(server)
      .post(`/api/v1/break-glass-requests/${requestId}/approve`)
      .set('Authorization', bearer(requester.accessToken))
      .set('Idempotency-Key', `i4-self-approve-${suffix}`)
      .expect(403);
    await request(server)
      .post(`/api/v1/break-glass-requests/${requestId}/approve`)
      .set('Authorization', bearer(secondAdmin.accessToken))
      .set('Idempotency-Key', `i4-approve-${suffix}`)
      .expect(200);
    await request(server)
      .post(`/api/v1/break-glass-requests/${requestId}/sessions`)
      .set('Authorization', bearer(requester.accessToken))
      .set('Idempotency-Key', `i4-start-break-glass-${suffix}`)
      .expect(201);
    await request(server)
      .post(`/api/v1/projects/${ids.project}/transitions`)
      .set('Authorization', bearer(requester.accessToken))
      .set('Idempotency-Key', `i4-break-glass-no-business-${suffix}`)
      .send({ action: 'suspend', expected_version: '1', reason: 'Must remain denied' })
      .expect(403);
    const audits = await verifier.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM vinops.audit_events
        WHERE entity_id = $1::uuid AND action IN ('break_glass.requested', 'break_glass.approved')`,
      [requestId],
    );
    expect(audits.rows[0]?.count).toBe('2');
  });
});
