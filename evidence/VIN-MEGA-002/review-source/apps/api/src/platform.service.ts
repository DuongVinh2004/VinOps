import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { parseAllowedOrigins } from '@vinops/config';
import { VinopsDatabase, type RefreshCredentialLookup, type Transaction } from '@vinops/database';
import {
  assertNoSensitiveSelfEscalation,
  assertDelegationEffective,
  assertProjectActivationPrerequisites,
  assertProjectMutable,
  assertResourceScope,
  normalizeEmail,
  parseExpectedVersion,
  projectTransitionTarget,
  type ProjectAction,
  type ProjectStatus,
  type ResourceScope,
} from '@vinops/domain';
import { API_CONFIG, type ApiRuntimeConfig } from './api-runtime.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { PlatformError } from './platform-error.js';
import {
  createOpaqueCredential,
  equalCredentialHash,
  expiredRefreshCookie,
  hashCredential,
  hashPassword,
  issueAccessToken,
  refreshCookie,
  verifyAccessToken,
  verifyPassword,
} from './security.js';

export type RequestIdentity = {
  userId: string;
  sessionId: string;
  authVersion: number;
  authorizationVersion: number;
};

export type SessionOutput = {
  access_token: string;
  access_token_expires_at: string;
  session_id: string;
  csrf_token: string;
  user: { id: string; display_name: string };
  refresh_cookie: string;
};

export type LoginInput = { email: string; password: string; deviceName?: string | undefined };
export type ProjectCreateInput = { code: string; name: string; timezone: string };
export type ProjectTransitionInput = {
  action: ProjectAction;
  expectedVersion: string;
  idempotencyKey: string;
  reason?: string | undefined;
};

type ProjectRow = {
  id: string;
  organization_id: string;
  code: string;
  name: string;
  timezone: string;
  status: ProjectStatus;
  version: string;
  archive_plan_reference: string | null;
  retention_plan_reference: string | null;
};

type OrganizationRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  version: string;
};

type MembershipRow = {
  id: string;
  user_id: string;
  project_id: string;
  organization_id: string;
  roles: string[];
  status: string;
  valid_to: Date | null;
  version: string;
  display_name: string;
};

type MemberScopeRow = {
  scope_type: ResourceScope['scopeType'];
  scope_id: string;
  actions: string[];
};

type ContextRow = Record<string, unknown> & { id: string };

type IdempotencyRow = {
  id: string;
  payload_hash: string;
  status: string;
  response_body: unknown;
};

type DatabaseFailure = { code?: string; message?: string };

function isDatabaseFailure(value: unknown): value is DatabaseFailure {
  return value !== null && typeof value === 'object';
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformError('IDEMPOTENCY_RESPONSE_INVALID', 'errors.internal', 500, false);
  }
  return value as Record<string, unknown>;
}

function toVersion(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new PlatformError('VERSION_INVALID', 'errors.validation', 422, false);
  }
}

function mapDatabaseFailure(error: unknown): never {
  if (isDatabaseFailure(error)) {
    const message = error.message ?? '';
    if (message.includes('INVITATION_EXPIRED')) {
      throw new PlatformError('INVITATION_EXPIRED', 'errors.invitationExpired', 422, false);
    }
    if (message.includes('INVITATION_INVALID')) {
      throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404, false);
    }
    if (message.includes('PROJECT_NOT_ACTIVE')) {
      throw new PlatformError('PROJECT_NOT_ACTIVE', 'errors.projectNotActive', 409, false);
    }
    if (message.includes('HARD_DELETE_FORBIDDEN')) {
      throw new PlatformError('HARD_DELETE_FORBIDDEN', 'errors.validation', 422, false);
    }
    if (error.code === '23505') {
      throw new PlatformError('CONFLICT', 'errors.conflict', 409, false);
    }
    if (error.code === '23514' || error.code === '22P02') {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
  }
  throw error;
}

@Injectable()
export class PlatformService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;
  private readonly allowedOrigins: readonly string[];

  constructor(
    @Inject(API_CONFIG) private readonly config: ApiRuntimeConfig,
    @Inject(AuthRateLimitService) private readonly rateLimit: AuthRateLimitService,
  ) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-api',
            runtimeRole: 'vinops_app',
          });
    this.allowedOrigins = parseAllowedOrigins(config.VINOPS_ALLOWED_ORIGINS);
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  async login(input: LoginInput, clientKey: string, correlationId: string): Promise<SessionOutput> {
    this.rateLimit.consume('login', clientKey);
    const database = this.requireDatabase();
    const user = await database.lookupLoginUser(normalizeEmail(input.email));
    const passwordMatches =
      user !== undefined &&
      user.status === 'Active' &&
      (await verifyPassword(input.password, user.password_hash));
    if (!passwordMatches || user === undefined) {
      throw new PlatformError(
        'AUTH_INVALID_CREDENTIALS',
        'errors.authInvalidCredentials',
        401,
        false,
      );
    }
    return this.createSessionForUser(user, input.deviceName, correlationId);
  }

  async refresh(
    refreshToken: string | undefined,
    csrfToken: string | undefined,
    origin: string | undefined,
    referer: string | undefined,
    correlationId: string,
  ): Promise<SessionOutput> {
    if (refreshToken === undefined || csrfToken === undefined) {
      throw new PlatformError(
        'AUTH_INVALID_CREDENTIALS',
        'errors.authInvalidCredentials',
        401,
        false,
      );
    }
    this.assertAllowedOrigin(origin, referer);
    const database = this.requireDatabase();
    const lookup = await database.lookupRefreshCredential(hashCredential(refreshToken));
    if (lookup === undefined) {
      throw new PlatformError(
        'AUTH_INVALID_CREDENTIALS',
        'errors.authInvalidCredentials',
        401,
        false,
      );
    }
    // A consumed credential is a replay signal even though rotating the
    // session also rotated its CSRF secret. Let the transactional reuse path
    // revoke the entire family before returning the same generic 401.
    if (
      lookup.credential_consumed_at === null &&
      !equalCredentialHash(hashCredential(csrfToken), lookup.csrf_secret_hash)
    ) {
      throw new PlatformError(
        'AUTH_INVALID_CREDENTIALS',
        'errors.authInvalidCredentials',
        401,
        false,
      );
    }
    let output: SessionOutput | undefined;
    try {
      output = await database.withTransaction(
        { actorUserId: lookup.user_id, correlationId },
        async (transaction) => this.rotateRefreshCredential(transaction, lookup, correlationId),
      );
    } catch (error) {
      mapDatabaseFailure(error);
    }
    if (output === undefined) {
      throw new PlatformError('AUTH_SESSION_REVOKED', 'errors.authSessionRevoked', 401, false);
    }
    return output;
  }

  async revokeSession(
    identity: RequestIdentity,
    sessionId: string,
    correlationId: string,
  ): Promise<void> {
    const database = this.requireDatabase();
    await database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) => {
        const changed = await transaction.execute(
          `UPDATE vinops.auth_sessions
            SET status = 'Revoked', revoked_at = now()
          WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'Active'`,
          [sessionId, identity.userId],
        );
        if (changed !== 1) {
          throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404, false);
        }
        await this.audit(transaction, {
          actorUserId: identity.userId,
          action: 'auth.session.revoked',
          entityType: 'auth_session',
          entityId: sessionId,
          correlationId,
        });
      },
    );
  }

  async revokeAllSessions(identity: RequestIdentity, correlationId: string): Promise<void> {
    const database = this.requireDatabase();
    await database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) => {
        await transaction.execute(
          `UPDATE vinops.auth_sessions
            SET status = 'Revoked', revoked_at = now()
          WHERE user_id = $1::uuid AND status = 'Active'`,
          [identity.userId],
        );
        await transaction.execute(
          `UPDATE vinops.refresh_token_families
            SET status = 'Revoked', revoked_at = now()
          WHERE user_id = $1::uuid AND status = 'Active'`,
          [identity.userId],
        );
        await this.audit(transaction, {
          actorUserId: identity.userId,
          action: 'auth.sessions.revoked_all',
          entityType: 'user',
          entityId: identity.userId,
          correlationId,
        });
      },
    );
  }

  async requestPasswordReset(
    email: string,
    clientKey: string,
    correlationId: string,
  ): Promise<void> {
    this.rateLimit.consume('password_reset', clientKey);
    const database = this.requireDatabase();
    const user = await database.lookupPasswordResetUser(normalizeEmail(email));
    if (user === undefined || user.status !== 'Active') {
      return;
    }
    const credential = createOpaqueCredential();
    await database.withTransaction({ actorUserId: user.id, correlationId }, async (transaction) => {
      const credentialId = randomUUID();
      await transaction.execute(
        `INSERT INTO vinops.password_reset_credentials (id, user_id, token_hash, expires_at)
         VALUES ($1::uuid, $2::uuid, $3, now() + interval '30 minutes')`,
        [credentialId, user.id, hashCredential(credential)],
      );
      await this.audit(transaction, {
        actorUserId: user.id,
        action: 'auth.password_reset.requested',
        entityType: 'password_reset_credential',
        entityId: credentialId,
        correlationId,
      });
      await this.outbox(transaction, {
        aggregateType: 'password_reset_credential',
        aggregateId: credentialId,
        eventType: 'password_reset.requested',
        payload: { credential_id: credentialId },
      });
    });
  }

  async confirmPasswordReset(
    token: string,
    password: string,
    correlationId: string,
  ): Promise<void> {
    const database = this.requireDatabase();
    const lookup = await database.lookupPasswordResetCredential(hashCredential(token));
    if (
      lookup === undefined ||
      lookup.used_at !== null ||
      lookup.status !== 'Active' ||
      lookup.expires_at.getTime() <= Date.now()
    ) {
      throw new PlatformError(
        'AUTH_INVALID_CREDENTIALS',
        'errors.authInvalidCredentials',
        401,
        false,
      );
    }
    const passwordHash = await hashPassword(password);
    await database.withTransaction(
      { actorUserId: lookup.user_id, correlationId },
      async (transaction) => {
        const consumed = await transaction.execute(
          `UPDATE vinops.password_reset_credentials SET used_at = now()
          WHERE id = $1::uuid AND used_at IS NULL AND expires_at > now()`,
          [lookup.credential_id],
        );
        if (consumed !== 1) {
          throw new PlatformError(
            'AUTH_INVALID_CREDENTIALS',
            'errors.authInvalidCredentials',
            401,
            false,
          );
        }
        await transaction.execute(
          `UPDATE vinops.users
            SET password_hash = $2, auth_version = auth_version + 1, authorization_version = authorization_version + 1
          WHERE id = $1::uuid`,
          [lookup.user_id, passwordHash],
        );
        await transaction.execute(
          `UPDATE vinops.auth_sessions SET status = 'Revoked', revoked_at = now()
          WHERE user_id = $1::uuid AND status = 'Active'`,
          [lookup.user_id],
        );
        await transaction.execute(
          `UPDATE vinops.refresh_token_families SET status = 'Revoked', revoked_at = now()
          WHERE user_id = $1::uuid AND status = 'Active'`,
          [lookup.user_id],
        );
        await this.audit(transaction, {
          actorUserId: lookup.user_id,
          action: 'auth.password_reset.completed',
          entityType: 'user',
          entityId: lookup.user_id,
          correlationId,
        });
      },
    );
  }

  async authenticate(
    authorization: string | undefined,
    correlationId: string,
  ): Promise<RequestIdentity> {
    const token = authorization?.match(/^Bearer\s+(.+)$/iu)?.[1];
    const secret = this.requireAuthSecret();
    if (token === undefined) {
      throw new PlatformError(
        'AUTH_INVALID_CREDENTIALS',
        'errors.authInvalidCredentials',
        401,
        false,
      );
    }
    const claims = verifyAccessToken(token, secret);
    const database = this.requireDatabase();
    const identity: RequestIdentity = {
      userId: claims.sub,
      sessionId: claims.sid,
      authVersion: claims.av,
      authorizationVersion: claims.azv,
    };
    await database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) => {
        const sessions = await transaction.query<{ id: string }>(
          `SELECT session.id
           FROM vinops.auth_sessions session
           JOIN vinops.refresh_token_families family ON family.id = session.family_id
           JOIN vinops.users user_record ON user_record.id = session.user_id
          WHERE session.id = $1::uuid
            AND session.user_id = $2::uuid
            AND session.status = 'Active'
            AND family.status = 'Active'
            AND family.idle_expires_at > now()
            AND family.absolute_expires_at > now()
            AND user_record.status = 'Active'
            AND user_record.auth_version = $3::bigint
            AND user_record.authorization_version = $4::bigint`,
          [
            identity.sessionId,
            identity.userId,
            String(identity.authVersion),
            String(identity.authorizationVersion),
          ],
        );
        if (sessions.length !== 1) {
          throw new PlatformError('AUTH_SESSION_REVOKED', 'errors.authSessionRevoked', 401, false);
        }
      },
    );
    return identity;
  }

  async createOrganization(
    identity: RequestIdentity,
    input: { code: string; name: string },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<OrganizationRow> {
    const database = this.requireDatabase();
    return this.withAuditedIdempotencyTransaction(
      database,
      identity.userId,
      correlationId,
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          'organization.create',
          idempotencyKey,
          input,
          async () => {
            const entitled = await transaction.query<{ allowed: boolean }>(
              "SELECT vinops.has_platform_entitlement('organization_create') AS allowed",
            );
            if (entitled[0]?.allowed !== true) {
              throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
            }
            const organizationId = randomUUID();
            const organization = await transaction.query<OrganizationRow>(
              `INSERT INTO vinops.organizations (id, code, name, created_by)
         VALUES ($1::uuid, $2, $3, $4::uuid)
         RETURNING id, code, name, status, version::text`,
              [organizationId, input.code.toUpperCase(), input.name.trim(), identity.userId],
            );
            await transaction.execute(
              `INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, ARRAY['organization_owner'], 'Active')`,
              [randomUUID(), organizationId, identity.userId],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId,
              action: 'organization.created',
              entityType: 'organization',
              entityId: organizationId,
              correlationId,
            });
            await this.outbox(transaction, {
              organizationId,
              aggregateType: 'organization',
              aggregateId: organizationId,
              eventType: 'organization.created',
              payload: { organization_id: organizationId },
            });
            return this.one(organization);
          },
        ),
    );
  }

  async listOrganizations(
    identity: RequestIdentity,
    correlationId: string,
  ): Promise<readonly OrganizationRow[]> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        transaction.query<OrganizationRow>(
          `SELECT id, code, name, status, version::text FROM vinops.organizations
          WHERE archived_at IS NULL ORDER BY code, id LIMIT 101`,
        ),
    );
  }

  async listOrganizationMembers(
    identity: RequestIdentity,
    organizationId: string,
    correlationId: string,
  ): Promise<readonly Record<string, unknown>[]> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        transaction.query<Record<string, unknown>>(
          `SELECT membership.id, membership.user_id, membership.roles, membership.status, membership.version::text,
            user_record.display_name
           FROM vinops.organization_members membership
           JOIN vinops.users user_record ON user_record.id = membership.user_id
          WHERE membership.organization_id = $1::uuid ORDER BY user_record.display_name, membership.id LIMIT 101`,
          [organizationId],
        ),
    );
  }

  async addOrganizationMember(
    identity: RequestIdentity,
    organizationId: string,
    input: { userId: string; roles: readonly string[] },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `organization_membership.create:${organizationId}`,
          idempotencyKey,
          input,
          async () => {
            await this.requireOrganizationOwner(transaction, organizationId, identity.userId);
            assertNoSensitiveSelfEscalation(identity.userId, input.userId, input.roles);
            const id = randomUUID();
            await transaction.execute(
              `INSERT INTO vinops.organization_members (id, organization_id, user_id, roles, status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text[], 'Active')`,
              [id, organizationId, input.userId, [...input.roles]],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId,
              action: 'organization_membership.created',
              entityType: 'organization_membership',
              entityId: id,
              correlationId,
            });
            return {
              id,
              organization_id: organizationId,
              user_id: input.userId,
              roles: input.roles,
              status: 'Active',
            };
          },
        ),
    );
  }

  async createProject(
    identity: RequestIdentity,
    organizationId: string,
    input: ProjectCreateInput,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<ProjectRow> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          'project.create',
          idempotencyKey,
          input,
          async () => {
            await this.requireOrganizationOwner(transaction, organizationId, identity.userId);
            const projectId = randomUUID();
            const projects = await transaction.query<ProjectRow>(
              `INSERT INTO vinops.projects (id, organization_id, code, name, timezone, created_by)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
           RETURNING id, organization_id, code, name, timezone, status, version::text,
             archive_plan_reference, retention_plan_reference`,
              [
                projectId,
                organizationId,
                input.code.toUpperCase(),
                input.name.trim(),
                input.timezone.trim(),
                identity.userId,
              ],
            );
            await transaction.execute(
              `INSERT INTO vinops.project_members (id, organization_id, project_id, user_id, roles, status, valid_from)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, ARRAY['project_admin'], 'Active', now())`,
              [randomUUID(), organizationId, projectId, identity.userId],
            );
            const calendarId = randomUUID();
            await transaction.execute(
              `INSERT INTO vinops.project_calendars (id, organization_id, project_id, name, timezone, working_days, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'Default', $4, ARRAY[1,2,3,4,5]::smallint[], $5::uuid)`,
              [calendarId, organizationId, projectId, input.timezone.trim(), identity.userId],
            );
            await transaction.execute(
              `INSERT INTO vinops.numbering_profiles (id, organization_id, project_id, code, name, template, created_by)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'DEFAULT', 'Default', '{PROJECT}-{SEQ:05}', $4::uuid)`,
              [randomUUID(), organizationId, projectId, identity.userId],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId,
              projectId,
              action: 'project.created',
              entityType: 'project',
              entityId: projectId,
              correlationId,
            });
            await this.outbox(transaction, {
              organizationId,
              projectId,
              aggregateType: 'project',
              aggregateId: projectId,
              eventType: 'project.created',
              payload: { project_id: projectId },
            });
            return this.one(projects);
          },
        ),
    );
  }

  async listProjects(
    identity: RequestIdentity,
    organizationId: string,
    correlationId: string,
  ): Promise<readonly ProjectRow[]> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        transaction.query<ProjectRow>(
          `SELECT id, organization_id, code, name, timezone, status, version::text, archive_plan_reference, retention_plan_reference
           FROM vinops.projects WHERE organization_id = $1::uuid ORDER BY code, id LIMIT 101`,
          [organizationId],
        ),
    );
  }

  async projectDetail(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<ProjectRow> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) => this.projectForRead(transaction, projectId),
    );
  }

  async transitionProject(
    identity: RequestIdentity,
    projectId: string,
    input: ProjectTransitionInput,
    correlationId: string,
  ): Promise<ProjectRow> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `project.transition:${projectId}`,
          input.idempotencyKey,
          input,
          async () => {
            const project = await this.projectForUpdate(transaction, projectId);
            const expectedVersion = parseExpectedVersion(input.expectedVersion);
            if (toVersion(project.version) !== expectedVersion) {
              throw new PlatformError('VERSION_CONFLICT', 'errors.conflict', 409, true);
            }
            const roles = await this.projectRoles(transaction, projectId, identity.userId);
            const orgOwner = await this.isOrganizationOwner(
              transaction,
              project.organization_id,
              identity.userId,
            );
            this.assertProjectTransitionAuthority(project, input, roles, orgOwner);
            if (input.action === 'activate') {
              const numbering = await transaction.query<{ id: string }>(
                `SELECT id FROM vinops.numbering_profiles
              WHERE project_id = $1::uuid AND status = 'Active' AND archived_at IS NULL LIMIT 1`,
                [projectId],
              );
              const owner = await transaction.query<{ id: string }>(
                `SELECT id FROM vinops.project_members
              WHERE project_id = $1::uuid AND status = 'Active' AND 'project_admin' = ANY(roles) LIMIT 1`,
                [projectId],
              );
              assertProjectActivationPrerequisites({
                timezone: project.timezone,
                numberingProfileId: numbering[0]?.id,
                hasOwnerMembership: owner.length > 0,
              });
            }
            const target = projectTransitionTarget(project.status, input.action);
            const rows = await transaction.query<ProjectRow>(
              `UPDATE vinops.projects
              SET status = $3,
                  suspended_at = CASE WHEN $3 = 'Suspended' THEN now() ELSE suspended_at END,
                  archived_at = CASE WHEN $3 = 'Archived' THEN now() ELSE archived_at END
            WHERE id = $1::uuid AND version = $2::bigint
          RETURNING id, organization_id, code, name, timezone, status, version::text,
            archive_plan_reference, retention_plan_reference`,
              [projectId, input.expectedVersion, target],
            );
            const changed = this.one(rows);
            const transitionId = randomUUID();
            await transaction.execute(
              `INSERT INTO vinops.entity_transitions (
            id, organization_id, project_id, entity_type, entity_id, action, from_state, to_state,
            expected_version, resulting_version, actor_user_id, reason, correlation_id
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, 'project', $3::uuid, $4, $5, $6, $7::bigint, $8::bigint, $9::uuid, $10, $11::uuid)`,
              [
                transitionId,
                project.organization_id,
                projectId,
                input.action,
                project.status,
                target,
                input.expectedVersion,
                changed.version,
                identity.userId,
                input.reason ?? null,
                correlationId,
              ],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: project.organization_id,
              projectId,
              action: `project.${input.action}`,
              entityType: 'project',
              entityId: projectId,
              entityVersion: changed.version,
              correlationId,
            });
            await this.outbox(transaction, {
              organizationId: project.organization_id,
              projectId,
              aggregateType: 'project',
              aggregateId: projectId,
              eventType: `project.${input.action}`,
              payload: { project_id: projectId, transition_id: transitionId, state: target },
            });
            return changed;
          },
        ),
    );
  }

  async createInvitation(
    identity: RequestIdentity,
    projectId: string,
    input: { email: string; roles: readonly string[]; validTo: string; scopes: unknown[] },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `invitation.create:${projectId}`,
          idempotencyKey,
          input,
          async () => {
            const project = await this.projectForRead(transaction, projectId);
            await this.requireProjectAdmin(transaction, projectId, identity.userId);
            const expiresAt = new Date(input.validTo);
            if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
              throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
            }
            const invitationId = randomUUID();
            await transaction.execute(
              `INSERT INTO vinops.invitations (
            id, organization_id, project_id, email_normalized, token_hash, roles, scopes, expires_at, created_by
          ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::text[], $7::jsonb, $8::timestamptz, $9::uuid)`,
              [
                invitationId,
                project.organization_id,
                projectId,
                normalizeEmail(input.email),
                hashCredential(createOpaqueCredential()),
                [...input.roles],
                JSON.stringify(input.scopes),
                expiresAt.toISOString(),
                identity.userId,
              ],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: project.organization_id,
              projectId,
              action: 'invitation.created',
              entityType: 'invitation',
              entityId: invitationId,
              correlationId,
            });
            await this.outbox(transaction, {
              organizationId: project.organization_id,
              projectId,
              aggregateType: 'invitation',
              aggregateId: invitationId,
              eventType: 'invitation.requested',
              payload: { invitation_id: invitationId },
            });
            return {
              id: invitationId,
              project_id: projectId,
              status: 'Pending',
              expires_at: expiresAt.toISOString(),
            };
          },
        ),
    );
  }

  async acceptInvitation(
    identity: RequestIdentity,
    token: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    try {
      const accepted = await database.acceptProjectInvitation(
        hashCredential(token),
        identity.userId,
        correlationId,
      );
      if (accepted === undefined) {
        throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404, false);
      }
      return {
        id: accepted.membership_id,
        project_id: accepted.project_id,
        organization_id: accepted.organization_id,
        roles: accepted.roles,
        version: accepted.version,
        status: 'Active',
      };
    } catch (error) {
      mapDatabaseFailure(error);
    }
  }

  async revokeInvitation(
    identity: RequestIdentity,
    projectId: string,
    invitationId: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `invitation.revoke:${projectId}`,
          idempotencyKey,
          { invitation_id: invitationId },
          async () => {
            await this.requireProjectAdmin(transaction, projectId, identity.userId);
            const changed = await transaction.execute(
              `UPDATE vinops.invitations SET status = 'Revoked', revoked_at = now()
          WHERE id = $1::uuid AND project_id = $2::uuid AND status = 'Pending'`,
              [invitationId, projectId],
            );
            if (changed !== 1) {
              throw new PlatformError(
                'RESOURCE_NOT_VISIBLE',
                'errors.resourceNotVisible',
                404,
                false,
              );
            }
            const project = await this.projectForRead(transaction, projectId);
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: project.organization_id,
              projectId,
              action: 'invitation.revoked',
              entityType: 'invitation',
              entityId: invitationId,
              correlationId,
            });
            await this.outbox(transaction, {
              organizationId: project.organization_id,
              projectId,
              aggregateType: 'invitation',
              aggregateId: invitationId,
              eventType: 'invitation.revoked',
              payload: { invitation_id: invitationId },
            });
            return { id: invitationId, status: 'Revoked' };
          },
        ),
    );
  }

  async listMembers(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<readonly MembershipRow[]> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        transaction.query<MembershipRow>(
          `SELECT membership.id, membership.user_id, membership.project_id, membership.organization_id, membership.roles,
            membership.status, membership.valid_to, membership.version::text,
            vinops.project_member_display_name(membership.user_id, membership.project_id) AS display_name
           FROM vinops.project_members membership
          WHERE membership.project_id = $1::uuid ORDER BY display_name, membership.id LIMIT 101`,
          [projectId],
        ),
    );
  }

  async updateMembership(
    identity: RequestIdentity,
    membershipId: string,
    input: {
      roles?: readonly string[] | undefined;
      status?: 'Active' | 'Suspended' | 'Ended' | undefined;
      validTo?: string | undefined;
      expectedVersion: string;
      reason?: string | undefined;
    },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `project_membership.update:${membershipId}`,
          idempotencyKey,
          input,
          async () => {
            const members = await transaction.query<MembershipRow>(
              `SELECT membership.id, membership.user_id, membership.project_id, membership.organization_id, membership.roles,
            membership.status, membership.valid_to, membership.version::text,
            vinops.project_member_display_name(membership.user_id, membership.project_id) AS display_name
           FROM vinops.project_members membership
          WHERE membership.id = $1::uuid FOR UPDATE`,
              [membershipId],
            );
            const member = this.one(members, 'RESOURCE_NOT_VISIBLE');
            await this.requireProjectAdmin(transaction, member.project_id, identity.userId);
            if (input.roles !== undefined) {
              assertNoSensitiveSelfEscalation(identity.userId, member.user_id, input.roles);
            }
            if (
              (input.status === 'Suspended' || input.status === 'Ended') &&
              (input.reason?.trim().length ?? 0) === 0
            ) {
              throw new PlatformError('REASON_REQUIRED', 'errors.validation', 422, false);
            }
            if (toVersion(member.version) !== parseExpectedVersion(input.expectedVersion)) {
              throw new PlatformError('VERSION_CONFLICT', 'errors.conflict', 409, true);
            }
            const validTo =
              input.validTo === undefined
                ? (member.valid_to?.toISOString() ?? null)
                : input.validTo;
            const roles = input.roles === undefined ? member.roles : [...input.roles];
            const status = input.status ?? member.status;
            const updated = await transaction.query<MembershipRow>(
              `UPDATE vinops.project_members
            SET roles = $2::text[], status = $3, valid_to = $4::timestamptz,
                ended_reason = CASE WHEN $3 IN ('Suspended', 'Ended') THEN $5 ELSE ended_reason END,
                ended_at = CASE WHEN $3 = 'Ended' THEN now() ELSE ended_at END
          WHERE id = $1::uuid AND version = $6::bigint
        RETURNING id, user_id, project_id, organization_id, roles, status, valid_to, version::text,
          vinops.project_member_display_name(user_id, project_id) AS display_name`,
              [membershipId, roles, status, validTo, input.reason ?? null, input.expectedVersion],
            );
            const result = this.one(updated);
            if (status === 'Suspended' || status === 'Ended') {
              await transaction.query(
                `SELECT vinops.revoke_project_member_sessions($1::uuid, $2::uuid)`,
                [member.user_id, member.project_id],
              );
            }
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: member.organization_id,
              projectId: member.project_id,
              action: 'project_membership.updated',
              entityType: 'project_membership',
              entityId: membershipId,
              entityVersion: result.version,
              correlationId,
            });
            await this.outbox(transaction, {
              organizationId: member.organization_id,
              projectId: member.project_id,
              aggregateType: 'project_membership',
              aggregateId: membershipId,
              eventType: `project_membership.${status.toLocaleLowerCase('en-US')}`,
              payload: { membership_id: membershipId, status },
            });
            return {
              id: result.id,
              project_id: result.project_id,
              user: { id: result.user_id, display_name: result.display_name },
              roles: result.roles,
              status: result.status,
              version: result.version,
            };
          },
        ),
    );
  }

  async projectContext(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) => {
        const project = await this.projectForRead(transaction, projectId);
        const [projectRoles, organizationAuthority, scopeRows] = await Promise.all([
          this.projectRoles(transaction, projectId, identity.userId),
          transaction.query<{ allowed: boolean }>(
            `SELECT EXISTS (
              SELECT 1 FROM vinops.organization_members
               WHERE organization_id = $1::uuid
                 AND user_id = $2::uuid
                 AND status = 'Active'
                 AND roles && ARRAY['organization_owner', 'security_admin']::text[]
            ) AS allowed`,
            [project.organization_id, identity.userId],
          ),
          transaction.query<MemberScopeRow>(
            `SELECT scope.scope_type, scope.scope_id, scope.actions
               FROM vinops.member_scopes scope
               JOIN vinops.project_members membership ON membership.id = scope.project_member_id
              WHERE scope.project_id = $1::uuid
                AND membership.user_id = $2::uuid
                AND scope.revoked_at IS NULL
                AND (scope.valid_from IS NULL OR scope.valid_from <= now())
                AND (scope.valid_to IS NULL OR scope.valid_to > now())`,
            [projectId, identity.userId],
          ),
        ]);
        const elevated =
          organizationAuthority[0]?.allowed === true ||
          projectRoles.includes('project_admin') ||
          projectRoles.includes('project_context_manager');
        const scopes: readonly ResourceScope[] = scopeRows.map((scope) => ({
          scopeType: scope.scope_type,
          scopeId: scope.scope_id,
          actions: scope.actions,
        }));
        const canRead = (scopeType: ResourceScope['scopeType'], scopeId: string): boolean => {
          if (elevated) {
            return true;
          }
          try {
            assertResourceScope(scopes, 'read', scopeType, scopeId);
            return true;
          } catch {
            return false;
          }
        };
        const filterRows = (
          rows: readonly ContextRow[],
          scopeType: ResourceScope['scopeType'],
          scopeId: (row: ContextRow) => string,
        ): readonly ContextRow[] => rows.filter((row) => canRead(scopeType, scopeId(row)));
        const [partners, calendars, profiles, locations, work, disciplines, classifications] =
          await Promise.all([
            transaction.query<ContextRow>(
              'SELECT id, code, name, status, version::text FROM vinops.partner_organizations WHERE project_id = $1::uuid ORDER BY code',
              [projectId],
            ),
            transaction.query<ContextRow>(
              'SELECT id, name, timezone, status, version::text FROM vinops.project_calendars WHERE project_id = $1::uuid ORDER BY name',
              [projectId],
            ),
            transaction.query<ContextRow>(
              'SELECT id, code, name, template, status, version::text FROM vinops.numbering_profiles WHERE project_id = $1::uuid ORDER BY code',
              [projectId],
            ),
            transaction.query<ContextRow>(
              'SELECT id, parent_id, code, name, node_type, status, version::text FROM vinops.location_nodes WHERE project_id = $1::uuid ORDER BY code',
              [projectId],
            ),
            transaction.query<ContextRow>(
              'SELECT id, parent_id, code, name, node_type, status, version::text FROM vinops.work_nodes WHERE project_id = $1::uuid ORDER BY code',
              [projectId],
            ),
            transaction.query<ContextRow>(
              'SELECT id, code, name, status, version::text FROM vinops.disciplines WHERE project_id = $1::uuid ORDER BY code',
              [projectId],
            ),
            transaction.query<ContextRow>(
              'SELECT id, parent_id, classification_type, code, name, status, version::text FROM vinops.document_classifications WHERE project_id = $1::uuid ORDER BY classification_type, code',
              [projectId],
            ),
          ]);
        return {
          project,
          partners: filterRows(partners, 'project', () => projectId),
          calendars: filterRows(calendars, 'project', () => projectId),
          numbering_profiles: filterRows(profiles, 'project', () => projectId),
          location_nodes: filterRows(locations, 'location', (row) => row.id),
          work_nodes: filterRows(work, 'work', (row) => row.id),
          disciplines: filterRows(disciplines, 'discipline', (row) => row.id),
          classifications: filterRows(classifications, 'classification', (row) => row.id),
        };
      },
    );
  }

  async createProjectContextEntity(
    identity: RequestIdentity,
    projectId: string,
    kind:
      | 'partner'
      | 'calendar'
      | 'numbering_profile'
      | 'location_node'
      | 'work_node'
      | 'discipline'
      | 'classification',
    input: Record<string, unknown>,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `context.create:${kind}:${projectId}`,
          idempotencyKey,
          input,
          async () => {
            const project = await this.projectForRead(transaction, projectId);
            assertProjectMutable(project.status);
            await this.requireProjectContextManager(transaction, projectId, identity.userId);
            const id = randomUUID();
            const code = this.stringField(input, 'code').toUpperCase();
            const name = this.stringField(input, 'name');
            if (kind === 'partner') {
              await transaction.execute(
                `INSERT INTO vinops.partner_organizations (id, organization_id, project_id, code, name, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
                [id, project.organization_id, projectId, code, name, identity.userId],
              );
            } else if (kind === 'calendar') {
              const timezone = this.stringField(input, 'timezone');
              await transaction.execute(
                `INSERT INTO vinops.project_calendars (id, organization_id, project_id, name, timezone, working_days, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, ARRAY[1,2,3,4,5]::smallint[], $6::uuid)`,
                [id, project.organization_id, projectId, name, timezone, identity.userId],
              );
            } else if (kind === 'numbering_profile') {
              await transaction.execute(
                `INSERT INTO vinops.numbering_profiles (id, organization_id, project_id, code, name, template, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid)`,
                [
                  id,
                  project.organization_id,
                  projectId,
                  code,
                  name,
                  this.stringField(input, 'template'),
                  identity.userId,
                ],
              );
            } else if (kind === 'location_node') {
              await transaction.execute(
                `INSERT INTO vinops.location_nodes (id, organization_id, project_id, parent_id, code, name, node_type, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid)`,
                [
                  id,
                  project.organization_id,
                  projectId,
                  this.optionalUuid(input, 'parent_id'),
                  code,
                  name,
                  this.stringField(input, 'node_type'),
                  identity.userId,
                ],
              );
            } else if (kind === 'work_node') {
              await transaction.execute(
                `INSERT INTO vinops.work_nodes (id, organization_id, project_id, parent_id, location_node_id, owner_partner_organization_id, code, name, node_type, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9, $10::uuid)`,
                [
                  id,
                  project.organization_id,
                  projectId,
                  this.optionalUuid(input, 'parent_id'),
                  this.optionalUuid(input, 'location_node_id'),
                  this.optionalUuid(input, 'owner_partner_organization_id'),
                  code,
                  name,
                  this.stringField(input, 'node_type'),
                  identity.userId,
                ],
              );
            } else if (kind === 'discipline') {
              await transaction.execute(
                `INSERT INTO vinops.disciplines (id, organization_id, project_id, code, name, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::uuid)`,
                [id, project.organization_id, projectId, code, name, identity.userId],
              );
            } else {
              await transaction.execute(
                `INSERT INTO vinops.document_classifications (id, organization_id, project_id, parent_id, classification_type, code, name, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8::uuid)`,
                [
                  id,
                  project.organization_id,
                  projectId,
                  this.optionalUuid(input, 'parent_id'),
                  this.stringField(input, 'classification_type'),
                  code,
                  name,
                  identity.userId,
                ],
              );
            }
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: project.organization_id,
              projectId,
              action: `project_context.${kind}.created`,
              entityType: kind,
              entityId: id,
              correlationId,
            });
            await this.outbox(transaction, {
              organizationId: project.organization_id,
              projectId,
              aggregateType: kind,
              aggregateId: id,
              eventType: `project_context.${kind}.created`,
              payload: { id, project_id: projectId },
            });
            return { id, project_id: projectId, kind, code, name, status: 'Active' };
          },
        ),
    );
  }

  async previewCsvImport(
    identity: RequestIdentity,
    projectId: string,
    input: { targetType: 'location_nodes' | 'work_nodes'; csv: string; idempotencyKey: string },
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      async (transaction) => {
        const project = await this.projectForRead(transaction, projectId);
        assertProjectMutable(project.status);
        await this.requireProjectContextManager(transaction, projectId, identity.userId);
        if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 255) {
          throw new PlatformError('IDEMPOTENCY_KEY_REQUIRED', 'errors.validation', 422, false);
        }
        const preview = this.parseCsvPreview(input.csv);
        const importId = randomUUID();
        const payloadHash = hashCredential(input.csv);
        const inserted = await transaction.query<{
          id: string;
          payload_hash: string;
          preview: unknown;
        }>(
          `INSERT INTO vinops.context_imports (id, organization_id, project_id, target_type, idempotency_key, payload_hash, status, preview, row_errors, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'Previewed', $7::jsonb, $8::jsonb, $9::uuid)
         ON CONFLICT (project_id, target_type, idempotency_key) DO NOTHING
         RETURNING id, payload_hash, preview`,
          [
            importId,
            project.organization_id,
            projectId,
            input.targetType,
            input.idempotencyKey,
            payloadHash,
            JSON.stringify(preview),
            JSON.stringify(preview.row_errors),
            identity.userId,
          ],
        );
        const importRecord =
          inserted[0] ??
          this.one(
            await transaction.query<{ id: string; payload_hash: string; preview: unknown }>(
              `SELECT id, payload_hash, preview FROM vinops.context_imports
              WHERE project_id = $1::uuid AND target_type = $2 AND idempotency_key = $3`,
              [projectId, input.targetType, input.idempotencyKey],
            ),
          );
        if (importRecord.payload_hash !== payloadHash) {
          throw new PlatformError(
            'IDEMPOTENCY_KEY_REUSE',
            'errors.idempotencyKeyReuse',
            409,
            false,
          );
        }
        return { import_id: importRecord.id, ...asRecord(importRecord.preview) };
      },
    );
  }

  async commitCsvImport(
    identity: RequestIdentity,
    projectId: string,
    importId: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `context_import.commit:${importId}`,
          idempotencyKey,
          { project_id: projectId, import_id: importId },
          async () => {
            const project = await this.projectForRead(transaction, projectId);
            assertProjectMutable(project.status);
            await this.requireProjectContextManager(transaction, projectId, identity.userId);
            const imports = await transaction.query<{
              id: string;
              target_type: 'location_nodes' | 'work_nodes';
              status: string;
              preview: unknown;
              row_errors: unknown;
            }>(
              `SELECT id, target_type, status, preview, row_errors FROM vinops.context_imports
          WHERE id = $1::uuid AND project_id = $2::uuid FOR UPDATE`,
              [importId, projectId],
            );
            const importRecord = this.one(imports);
            if (importRecord.status === 'Committed') {
              return { import_id: importId, status: 'Committed', duplicate_safe: true };
            }
            const preview = asRecord(importRecord.preview);
            const rows = preview.rows;
            if (!Array.isArray(rows) || importRecord.status !== 'Previewed') {
              throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
            }
            const errorRows = importRecord.row_errors;
            if (Array.isArray(errorRows) && errorRows.length > 0) {
              throw new PlatformError('CSV_VALIDATION_FAILED', 'errors.validation', 422, false);
            }
            for (const rawRow of rows) {
              const row = asRecord(rawRow);
              const id = randomUUID();
              const code = this.stringField(row, 'code').toUpperCase();
              const name = this.stringField(row, 'name');
              if (importRecord.target_type === 'location_nodes') {
                await transaction.execute(
                  `INSERT INTO vinops.location_nodes (id, organization_id, project_id, code, name, node_type, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'imported', $6::uuid)
             ON CONFLICT DO NOTHING`,
                  [id, project.organization_id, projectId, code, name, identity.userId],
                );
              } else {
                await transaction.execute(
                  `INSERT INTO vinops.work_nodes (id, organization_id, project_id, code, name, node_type, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'work_package', $6::uuid)
             ON CONFLICT DO NOTHING`,
                  [id, project.organization_id, projectId, code, name, identity.userId],
                );
              }
            }
            await transaction.execute(
              `UPDATE vinops.context_imports SET status = 'Committed', committed_at = now() WHERE id = $1::uuid`,
              [importId],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: project.organization_id,
              projectId,
              action: 'context_import.committed',
              entityType: 'context_import',
              entityId: importId,
              correlationId,
            });
            await this.outbox(transaction, {
              organizationId: project.organization_id,
              projectId,
              aggregateType: 'context_import',
              aggregateId: importId,
              eventType: 'context_import.committed',
              payload: { import_id: importId },
            });
            return { import_id: importId, status: 'Committed', duplicate_safe: true };
          },
        ),
    );
  }

  async createDelegation(
    identity: RequestIdentity,
    projectId: string,
    input: {
      delegateeUserId: string;
      scopeType: string;
      scopeId: string;
      actions: readonly string[];
      validFrom: string;
      validTo: string;
      reason: string;
    },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `delegation.create:${projectId}`,
          idempotencyKey,
          input,
          async () => {
            const project = await this.projectForRead(transaction, projectId);
            await this.requireProjectAdmin(transaction, projectId, identity.userId);
            if (input.delegateeUserId === identity.userId) {
              throw new PlatformError('SEPARATION_OF_DUTY', 'errors.separationOfDuty', 403, false);
            }
            assertDelegationEffective(
              {
                validFrom: new Date(input.validFrom),
                validTo: new Date(input.validTo),
                reason: input.reason,
              },
              new Date(),
            );
            const id = randomUUID();
            await transaction.execute(
              `INSERT INTO vinops.delegations (
          id, organization_id, project_id, delegator_user_id, delegatee_user_id, scope_type, scope_id, actions, reason, valid_from, valid_to
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::uuid, $8::text[], $9, $10::timestamptz, $11::timestamptz)`,
              [
                id,
                project.organization_id,
                projectId,
                identity.userId,
                input.delegateeUserId,
                input.scopeType,
                input.scopeId,
                [...input.actions],
                input.reason,
                input.validFrom,
                input.validTo,
              ],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: project.organization_id,
              projectId,
              action: 'delegation.created',
              entityType: 'delegation',
              entityId: id,
              correlationId,
            });
            return { id, project_id: projectId, status: 'Active' };
          },
        ),
    );
  }

  async requestBreakGlass(
    identity: RequestIdentity,
    projectId: string,
    input: {
      scopeType: string;
      scopeId: string;
      actions: readonly string[];
      reason: string;
      validFrom: string;
      validTo: string;
    },
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `break_glass.request:${projectId}`,
          idempotencyKey,
          input,
          async () => {
            const project = await this.projectForRead(transaction, projectId);
            const validFrom = new Date(input.validFrom);
            const validTo = new Date(input.validTo);
            if (
              input.reason.trim().length === 0 ||
              !Number.isFinite(validFrom.getTime()) ||
              !Number.isFinite(validTo.getTime()) ||
              validTo.getTime() - validFrom.getTime() > 4 * 60 * 60 * 1_000
            ) {
              throw new PlatformError(
                'BREAK_GLASS_NOT_EFFECTIVE',
                'errors.breakGlassNotEffective',
                422,
                false,
              );
            }
            const id = randomUUID();
            await transaction.execute(
              `INSERT INTO vinops.break_glass_requests (
          id, organization_id, project_id, requester_user_id, reason, scope_type, scope_id, actions, valid_from, valid_to
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid, $8::text[], $9::timestamptz, $10::timestamptz)`,
              [
                id,
                project.organization_id,
                projectId,
                identity.userId,
                input.reason,
                input.scopeType,
                input.scopeId,
                [...input.actions],
                input.validFrom,
                input.validTo,
              ],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: project.organization_id,
              projectId,
              action: 'break_glass.requested',
              entityType: 'break_glass_request',
              entityId: id,
              correlationId,
            });
            return { id, project_id: projectId, status: 'Requested', banner: false };
          },
        ),
    );
  }

  async approveBreakGlass(
    identity: RequestIdentity,
    requestId: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `break_glass.approve:${requestId}`,
          idempotencyKey,
          { request_id: requestId },
          async () => {
            const requests = await transaction.query<{
              id: string;
              project_id: string;
              organization_id: string;
              requester_user_id: string;
              valid_to: Date;
              status: string;
            }>(
              `SELECT id, project_id, organization_id, requester_user_id, valid_to, status
           FROM vinops.break_glass_requests WHERE id = $1::uuid FOR UPDATE`,
              [requestId],
            );
            const request = this.one(requests);
            await this.requireProjectAdmin(transaction, request.project_id, identity.userId);
            if (
              request.requester_user_id === identity.userId ||
              request.status !== 'Requested' ||
              request.valid_to.getTime() <= Date.now()
            ) {
              throw new PlatformError('SEPARATION_OF_DUTY', 'errors.separationOfDuty', 403, false);
            }
            await transaction.execute(
              `UPDATE vinops.break_glass_requests
            SET status = 'Approved', approver_user_id = $2::uuid, approved_at = now()
          WHERE id = $1::uuid`,
              [requestId, identity.userId],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: request.organization_id,
              projectId: request.project_id,
              action: 'break_glass.approved',
              entityType: 'break_glass_request',
              entityId: requestId,
              correlationId,
            });
            return { id: requestId, status: 'Approved' };
          },
        ),
    );
  }

  async startBreakGlassSession(
    identity: RequestIdentity,
    requestId: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<Record<string, unknown>> {
    const database = this.requireDatabase();
    return database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      (transaction) =>
        this.idempotent(
          transaction,
          identity.userId,
          `break_glass.session.start:${requestId}`,
          idempotencyKey,
          { request_id: requestId },
          async () => {
            const requests = await transaction.query<{
              id: string;
              project_id: string;
              organization_id: string;
              requester_user_id: string;
              valid_from: Date;
              valid_to: Date;
              status: string;
            }>(
              `SELECT id, project_id, organization_id, requester_user_id, valid_from, valid_to, status
           FROM vinops.break_glass_requests WHERE id = $1::uuid FOR UPDATE`,
              [requestId],
            );
            const request = this.one(requests);
            if (
              request.requester_user_id !== identity.userId ||
              request.status !== 'Approved' ||
              request.valid_from.getTime() > Date.now() ||
              request.valid_to.getTime() <= Date.now()
            ) {
              throw new PlatformError(
                'BREAK_GLASS_NOT_EFFECTIVE',
                'errors.breakGlassNotEffective',
                403,
                false,
              );
            }
            const id = randomUUID();
            await transaction.execute(
              `INSERT INTO vinops.break_glass_sessions (id, request_id, user_id, expires_at, banner_acknowledged_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz, now())`,
              [id, requestId, identity.userId, request.valid_to.toISOString()],
            );
            await this.audit(transaction, {
              actorUserId: identity.userId,
              organizationId: request.organization_id,
              projectId: request.project_id,
              action: 'break_glass.session_started',
              entityType: 'break_glass_session',
              entityId: id,
              correlationId,
            });
            return {
              id,
              request_id: requestId,
              status: 'Active',
              banner: true,
              expires_at: request.valid_to.toISOString(),
            };
          },
        ),
    );
  }

  refreshCookieClear(): string {
    return expiredRefreshCookie(this.config.VINOPS_REFRESH_COOKIE_SECURE);
  }

  private async createSessionForUser(
    user: { id: string; display_name: string; auth_version: string; authorization_version: string },
    deviceName: string | undefined,
    correlationId: string,
  ): Promise<SessionOutput> {
    const database = this.requireDatabase();
    const refresh = createOpaqueCredential();
    const csrf = createOpaqueCredential();
    const familyId = randomUUID();
    const sessionId = randomUUID();
    await database.withTransaction({ actorUserId: user.id, correlationId }, async (transaction) => {
      await transaction.execute(
        `INSERT INTO vinops.refresh_token_families (
          id, user_id, auth_version, authorization_version, idle_expires_at, absolute_expires_at
        ) VALUES ($1::uuid, $2::uuid, $3::bigint, $4::bigint,
          now() + ($5::text || ' days')::interval, now() + ($6::text || ' days')::interval)`,
        [
          familyId,
          user.id,
          user.auth_version,
          user.authorization_version,
          String(this.config.VINOPS_REFRESH_IDLE_TTL_DAYS),
          String(this.config.VINOPS_REFRESH_ABSOLUTE_TTL_DAYS),
        ],
      );
      await transaction.execute(
        `INSERT INTO vinops.auth_sessions (
          id, user_id, family_id, device_name, auth_version, authorization_version, csrf_secret_hash
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::bigint, $6::bigint, $7)`,
        [
          sessionId,
          user.id,
          familyId,
          deviceName ?? null,
          user.auth_version,
          user.authorization_version,
          hashCredential(csrf),
        ],
      );
      await transaction.execute(
        `INSERT INTO vinops.refresh_token_credentials (id, session_id, family_id, token_hash, expires_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + ($5::text || ' days')::interval)`,
        [
          randomUUID(),
          sessionId,
          familyId,
          hashCredential(refresh),
          String(this.config.VINOPS_REFRESH_ABSOLUTE_TTL_DAYS),
        ],
      );
      await this.audit(transaction, {
        actorUserId: user.id,
        action: 'auth.session.created',
        entityType: 'auth_session',
        entityId: sessionId,
        correlationId,
      });
    });
    return this.sessionOutput(user, sessionId, csrf, refresh);
  }

  private async rotateRefreshCredential(
    transaction: Transaction,
    lookup: RefreshCredentialLookup,
    correlationId: string,
  ): Promise<SessionOutput | undefined> {
    const invalid =
      lookup.credential_consumed_at !== null ||
      lookup.credential_revoked_at !== null ||
      lookup.credential_expires_at.getTime() <= Date.now() ||
      lookup.family_idle_expires_at.getTime() <= Date.now() ||
      lookup.family_absolute_expires_at.getTime() <= Date.now() ||
      lookup.session_status !== 'Active' ||
      lookup.family_status !== 'Active';
    if (invalid) {
      if (lookup.credential_consumed_at !== null) {
        await transaction.execute(
          `UPDATE vinops.refresh_token_families SET status = 'Revoked', revoked_at = now(), reuse_detected_at = now()
            WHERE id = $1::uuid AND status = 'Active'`,
          [lookup.family_id],
        );
        await transaction.execute(
          `UPDATE vinops.auth_sessions SET status = 'Revoked', revoked_at = now()
            WHERE family_id = $1::uuid AND status = 'Active'`,
          [lookup.family_id],
        );
        await this.audit(transaction, {
          actorUserId: lookup.user_id,
          action: 'auth.refresh_reuse_detected',
          entityType: 'refresh_token_family',
          entityId: lookup.family_id,
          correlationId,
          outcome: 'denied',
        });
      }
      return undefined;
    }
    const consumed = await transaction.execute(
      `UPDATE vinops.refresh_token_credentials SET consumed_at = now()
        WHERE id = $1::uuid AND consumed_at IS NULL AND revoked_at IS NULL`,
      [lookup.credential_id],
    );
    if (consumed !== 1) {
      await transaction.execute(
        `UPDATE vinops.refresh_token_families SET status = 'Revoked', revoked_at = now(), reuse_detected_at = now()
          WHERE id = $1::uuid AND status = 'Active'`,
        [lookup.family_id],
      );
      await transaction.execute(
        `UPDATE vinops.auth_sessions SET status = 'Revoked', revoked_at = now()
          WHERE family_id = $1::uuid AND status = 'Active'`,
        [lookup.family_id],
      );
      await this.audit(transaction, {
        actorUserId: lookup.user_id,
        action: 'auth.refresh_reuse_detected',
        entityType: 'refresh_token_family',
        entityId: lookup.family_id,
        correlationId,
        outcome: 'denied',
      });
      return undefined;
    }
    const refresh = createOpaqueCredential();
    await transaction.execute(
      `INSERT INTO vinops.refresh_token_credentials (id, session_id, family_id, token_hash, parent_credential_id, expires_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, now() + ($6::text || ' days')::interval)`,
      [
        randomUUID(),
        lookup.session_id,
        lookup.family_id,
        hashCredential(refresh),
        lookup.credential_id,
        String(this.config.VINOPS_REFRESH_ABSOLUTE_TTL_DAYS),
      ],
    );
    await transaction.execute(
      `UPDATE vinops.refresh_token_families
          SET last_rotated_at = now(), idle_expires_at = LEAST(absolute_expires_at, now() + ($2::text || ' days')::interval)
        WHERE id = $1::uuid`,
      [lookup.family_id, String(this.config.VINOPS_REFRESH_IDLE_TTL_DAYS)],
    );
    const users = await transaction.query<{
      id: string;
      display_name: string;
      auth_version: string;
      authorization_version: string;
    }>(
      `SELECT id, display_name, auth_version::text, authorization_version::text FROM vinops.users WHERE id = $1::uuid`,
      [lookup.user_id],
    );
    const user = this.one(users);
    const csrf = createOpaqueCredential();
    await transaction.execute(
      `UPDATE vinops.auth_sessions SET csrf_secret_hash = $2, last_seen_at = now() WHERE id = $1::uuid`,
      [lookup.session_id, hashCredential(csrf)],
    );
    await this.audit(transaction, {
      actorUserId: lookup.user_id,
      action: 'auth.session.refreshed',
      entityType: 'auth_session',
      entityId: lookup.session_id,
      correlationId,
    });
    return this.sessionOutput(user, lookup.session_id, csrf, refresh);
  }

  private sessionOutput(
    user: { id: string; display_name: string; auth_version: string; authorization_version: string },
    sessionId: string,
    csrf: string,
    refresh: string,
  ): SessionOutput {
    const issued = issueAccessToken(
      {
        sub: user.id,
        sid: sessionId,
        av: Number(user.auth_version),
        azv: Number(user.authorization_version),
      },
      this.requireAuthSecret(),
      this.config.VINOPS_ACCESS_TOKEN_TTL_SECONDS,
    );
    return {
      access_token: issued.token,
      access_token_expires_at: issued.expiresAt.toISOString(),
      session_id: sessionId,
      csrf_token: csrf,
      user: { id: user.id, display_name: user.display_name },
      refresh_cookie: refreshCookie(
        refresh,
        this.config.VINOPS_REFRESH_COOKIE_SECURE,
        this.config.VINOPS_REFRESH_ABSOLUTE_TTL_DAYS * 86_400,
      ),
    };
  }

  private assertAllowedOrigin(origin: string | undefined, referer: string | undefined): void {
    let candidate = origin;
    if (candidate === undefined && referer !== undefined) {
      try {
        candidate = new URL(referer).origin;
      } catch {
        candidate = undefined;
      }
    }
    if (candidate === undefined || !this.allowedOrigins.includes(candidate)) {
      throw new PlatformError('CSRF_ORIGIN_DENIED', 'errors.csrfOriginDenied', 403, false);
    }
  }

  private requireDatabase(): VinopsDatabase {
    if (this.database === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.database;
  }

  private requireAuthSecret(): string {
    if (this.config.VINOPS_AUTH_TOKEN_SECRET === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.config.VINOPS_AUTH_TOKEN_SECRET;
  }

  private one<T>(rows: readonly T[], code = 'RESOURCE_NOT_VISIBLE'): T {
    const value = rows[0];
    if (value === undefined) {
      throw new PlatformError(
        code,
        code === 'RESOURCE_NOT_VISIBLE' ? 'errors.resourceNotVisible' : 'errors.internal',
        code === 'RESOURCE_NOT_VISIBLE' ? 404 : 500,
        false,
      );
    }
    return value;
  }

  private async projectForRead(transaction: Transaction, projectId: string): Promise<ProjectRow> {
    return this.one(
      await transaction.query<ProjectRow>(
        `SELECT id, organization_id, code, name, timezone, status, version::text, archive_plan_reference, retention_plan_reference
           FROM vinops.projects WHERE id = $1::uuid`,
        [projectId],
      ),
    );
  }

  private async projectForUpdate(transaction: Transaction, projectId: string): Promise<ProjectRow> {
    return this.one(
      await transaction.query<ProjectRow>(
        `SELECT id, organization_id, code, name, timezone, status, version::text, archive_plan_reference, retention_plan_reference
           FROM vinops.projects WHERE id = $1::uuid FOR UPDATE`,
        [projectId],
      ),
    );
  }

  private async projectRoles(
    transaction: Transaction,
    projectId: string,
    userId: string,
  ): Promise<readonly string[]> {
    const rows = await transaction.query<{ roles: string[] }>(
      `SELECT roles FROM vinops.project_members
        WHERE project_id = $1::uuid AND user_id = $2::uuid AND status = 'Active'
          AND (valid_from IS NULL OR valid_from <= now()) AND (valid_to IS NULL OR valid_to > now())`,
      [projectId, userId],
    );
    return rows[0]?.roles ?? [];
  }

  private async isOrganizationOwner(
    transaction: Transaction,
    organizationId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await transaction.query<{ is_owner: boolean }>(
      `SELECT EXISTS (
        SELECT 1 FROM vinops.organization_members
         WHERE organization_id = $1::uuid AND user_id = $2::uuid AND status = 'Active'
           AND 'organization_owner' = ANY(roles)
      ) AS is_owner`,
      [organizationId, userId],
    );
    return rows[0]?.is_owner === true;
  }

  private async requireOrganizationOwner(
    transaction: Transaction,
    organizationId: string,
    userId: string,
  ): Promise<void> {
    if (!(await this.isOrganizationOwner(transaction, organizationId, userId))) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
  }

  private async requireProjectAdmin(
    transaction: Transaction,
    projectId: string,
    userId: string,
  ): Promise<void> {
    const roles = await this.projectRoles(transaction, projectId, userId);
    if (!roles.includes('project_admin')) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
  }

  private async requireProjectContextManager(
    transaction: Transaction,
    projectId: string,
    userId: string,
  ): Promise<void> {
    const roles = await this.projectRoles(transaction, projectId, userId);
    if (!roles.includes('project_admin') && !roles.includes('project_context_manager')) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
  }

  private assertProjectTransitionAuthority(
    project: ProjectRow,
    input: ProjectTransitionInput,
    projectRoles: readonly string[],
    isOrganizationOwner: boolean,
  ): void {
    const projectAdmin = projectRoles.includes('project_admin');
    const reasonRequired =
      input.action === 'suspend' ||
      input.action === 'resume' ||
      input.action === 'start_archive' ||
      input.action === 'restore';
    if (reasonRequired && (input.reason?.trim().length ?? 0) === 0) {
      throw new PlatformError('REASON_REQUIRED', 'errors.validation', 422, false);
    }
    if (input.action === 'activate' && !projectAdmin) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
    if (
      (input.action === 'suspend' || input.action === 'resume') &&
      !projectAdmin &&
      !isOrganizationOwner
    ) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
    if ((input.action === 'start_archive' || input.action === 'restore') && !isOrganizationOwner) {
      throw new PlatformError('PERMISSION_DENIED', 'errors.permissionDenied', 403, false);
    }
    if (input.action === 'complete_archive') {
      throw new PlatformError(
        'ARCHIVE_COMPLETION_REQUIRES_JOB',
        'errors.permissionDenied',
        403,
        false,
      );
    }
    if (
      input.action === 'start_archive' &&
      (project.archive_plan_reference === null || project.retention_plan_reference === null)
    ) {
      throw new PlatformError('ARCHIVE_PREREQUISITES_MISSING', 'errors.validation', 422, false);
    }
    if (input.action === 'restore' && project.retention_plan_reference === null) {
      throw new PlatformError('RESTORE_PREREQUISITES_MISSING', 'errors.validation', 422, false);
    }
  }

  private async withAuditedIdempotencyTransaction<T>(
    database: VinopsDatabase,
    actorUserId: string,
    correlationId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    try {
      return await database.withTransaction({ actorUserId, correlationId }, operation);
    } catch (error) {
      if (error instanceof PlatformError && error.code === 'IDEMPOTENCY_KEY_REUSE') {
        await database.withTransaction({ actorUserId, correlationId }, async (transaction) => {
          await this.audit(transaction, {
            actorUserId,
            action: 'idempotency.key_reuse_denied',
            entityType: 'idempotency_key',
            correlationId,
            outcome: 'denied',
          });
        });
      }
      throw error;
    }
  }

  private async idempotent<T extends Record<string, unknown>>(
    transaction: Transaction,
    actorUserId: string,
    operation: string,
    idempotencyKey: string,
    payload: unknown,
    action: () => Promise<T>,
  ): Promise<T> {
    if (idempotencyKey.length < 8 || idempotencyKey.length > 255) {
      throw new PlatformError('IDEMPOTENCY_KEY_REQUIRED', 'errors.validation', 422, false);
    }
    const payloadHash = hashCredential(stableJson(payload));
    const id = randomUUID();
    const inserted = await transaction.query<{ id: string }>(
      `INSERT INTO vinops.idempotency_keys (id, actor_user_id, operation, idempotency_key, payload_hash)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)
       ON CONFLICT (actor_user_id, operation, idempotency_key) DO NOTHING
       RETURNING id`,
      [id, actorUserId, operation, idempotencyKey, payloadHash],
    );
    if (inserted.length === 0) {
      const existing = this.one(
        await transaction.query<IdempotencyRow>(
          `SELECT id, payload_hash, status, response_body
             FROM vinops.idempotency_keys
            WHERE actor_user_id = $1::uuid AND operation = $2 AND idempotency_key = $3 FOR UPDATE`,
          [actorUserId, operation, idempotencyKey],
        ),
      );
      if (existing.payload_hash !== payloadHash) {
        throw new PlatformError('IDEMPOTENCY_KEY_REUSE', 'errors.idempotencyKeyReuse', 409, false);
      }
      if (existing.status === 'Completed' && existing.response_body !== null) {
        return asRecord(existing.response_body) as T;
      }
      throw new PlatformError('IDEMPOTENCY_IN_PROGRESS', 'errors.conflict', 409, true);
    }
    const result = await action();
    await transaction.execute(
      `UPDATE vinops.idempotency_keys
          SET status = 'Completed', response_code = 200, response_body = $2::jsonb, completed_at = now()
        WHERE id = $1::uuid`,
      [id, JSON.stringify(result)],
    );
    return result;
  }

  private async audit(
    transaction: Transaction,
    event: {
      actorUserId: string;
      organizationId?: string;
      projectId?: string;
      action: string;
      entityType: string;
      entityId?: string;
      entityVersion?: string;
      correlationId: string;
      outcome?: 'success' | 'denied' | 'failed';
    },
  ): Promise<void> {
    await transaction.execute(
      `INSERT INTO vinops.audit_events (
        id, organization_id, project_id, actor_user_id, action, entity_type, entity_id, entity_version, outcome, correlation_id
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::uuid, $8::bigint, $9, $10::uuid)`,
      [
        randomUUID(),
        event.organizationId ?? null,
        event.projectId ?? null,
        event.actorUserId,
        event.action,
        event.entityType,
        event.entityId ?? null,
        event.entityVersion ?? null,
        event.outcome ?? 'success',
        event.correlationId,
      ],
    );
  }

  private async outbox(
    transaction: Transaction,
    event: {
      organizationId?: string;
      projectId?: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await transaction.execute(
      `INSERT INTO vinops.outbox_events (
        id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::jsonb)`,
      [
        randomUUID(),
        event.organizationId ?? null,
        event.projectId ?? null,
        event.aggregateType,
        event.aggregateId,
        event.eventType,
        JSON.stringify(event.payload),
      ],
    );
  }

  private stringField(input: Record<string, unknown>, name: string): string {
    const value = input[name];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    return value.trim();
  }

  private optionalUuid(input: Record<string, unknown>, name: string): string | null {
    const value = input[name];
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (
      typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    ) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    return value;
  }

  private parseCsvPreview(csv: string): {
    valid_rows: number;
    invalid_rows: number;
    row_errors: readonly Record<string, unknown>[];
    rows: readonly Record<string, unknown>[];
  } {
    const rows = csv.split(/\r?\n/u).filter((row) => row.trim().length > 0);
    if (rows.length < 2) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    const header = rows[0]?.split(',').map((column) => column.trim().toLowerCase()) ?? [];
    const codeIndex = header.indexOf('code');
    const nameIndex = header.indexOf('name');
    if (codeIndex < 0 || nameIndex < 0) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    const seen = new Set<string>();
    const rowErrors: Record<string, unknown>[] = [];
    const parsedRows: Record<string, unknown>[] = [];
    for (const [offset, row] of rows.slice(1).entries()) {
      const columns = row.split(',').map((value) => value.trim());
      const code = columns[codeIndex] ?? '';
      const name = columns[nameIndex] ?? '';
      parsedRows.push({ code, name });
      if (code.length === 0 || name.length === 0 || seen.has(code)) {
        rowErrors.push({
          row: offset + 2,
          code:
            code.length === 0
              ? 'CODE_REQUIRED'
              : name.length === 0
                ? 'NAME_REQUIRED'
                : 'DUPLICATE_CODE',
        });
      }
      seen.add(code);
    }
    return {
      valid_rows: rows.length - 1 - rowErrors.length,
      invalid_rows: rowErrors.length,
      row_errors: rowErrors,
      rows: parsedRows,
    };
  }
}
