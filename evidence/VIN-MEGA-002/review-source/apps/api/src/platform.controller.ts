import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PlatformError } from './platform-error.js';
import type { CorrelatedRequest } from './request-context.js';
import { PlatformService, type RequestIdentity, type SessionOutput } from './platform.service.js';
import { DocumentService } from './document.service.js';
import { readCookie } from './security.js';

type Request = CorrelatedRequest;

function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return body as Record<string, unknown>;
}

function allowKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(body).some((key) => !allowedSet.has(key))) {
    throw new PlatformError('DTO_FIELD_NOT_ALLOWED', 'errors.validation', 422, false);
  }
}

function requiredRecord(body: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = body[name];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value.trim();
}

function optionalNonNegativeIntegerString(
  body: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = optionalString(body, name);
  if (value !== undefined && !/^(0|[1-9]\d*)$/u.test(value)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value.trim();
}

function stringArray(body: Record<string, unknown>, name: string): readonly string[] {
  const value = body[name];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string')
  ) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value as string[];
}

function unknownArray(body: Record<string, unknown>, name: string): unknown[] {
  const value = body[name];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value;
}

function nonEmptyRecordArray(
  body: Record<string, unknown>,
  name: string,
): readonly Record<string, unknown>[] {
  const value = body[name];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => item === null || typeof item !== 'object' || Array.isArray(item))
  ) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value as Record<string, unknown>[];
}

function optionalNumber(body: Record<string, unknown>, name: string): number | undefined {
  const value = body[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value;
}

function requiredNumber(body: Record<string, unknown>, name: string): number {
  const value = optionalNumber(body, name);
  if (value === undefined)
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  return value;
}

function uuidArray(body: Record<string, unknown>, name: string): readonly string[] {
  return stringArray(body, name);
}

function revisionAction(
  value: string,
): 'submit_review' | 'approve' | 'approve_with_comments' | 'reject' | 'publish' | 'withdraw' {
  if (
    ![
      'submit_review',
      'approve',
      'approve_with_comments',
      'reject',
      'publish',
      'withdraw',
    ].includes(value)
  ) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value as ReturnType<typeof revisionAction>;
}

function idempotencyKey(request: Request): string {
  const value = request.header('idempotency-key');
  if (value === undefined) {
    throw new PlatformError('IDEMPOTENCY_KEY_REQUIRED', 'errors.validation', 422, false);
  }
  return value;
}

function sessionResponse(output: SessionOutput): Omit<SessionOutput, 'refresh_cookie'> {
  return {
    access_token: output.access_token,
    access_token_expires_at: output.access_token_expires_at,
    session_id: output.session_id,
    csrf_token: output.csrf_token,
    user: output.user,
  };
}

@Controller('api/v1')
export class PlatformController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(DocumentService) private readonly documents: DocumentService,
  ) {}

  @Post('auth/sessions')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const output = await this.platform.login(
      {
        email: requiredString(input, 'email'),
        password: requiredString(input, 'password'),
        deviceName: optionalString(input, 'device_name'),
      },
      request.ip ?? 'unknown',
      request.vinopsCorrelationId,
    );
    response.setHeader('Set-Cookie', output.refresh_cookie);
    response.setHeader('Cache-Control', 'no-store');
    return sessionResponse(output);
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Headers('x-csrf-token') csrfToken: string | undefined,
    @Headers('origin') origin: string | undefined,
    @Headers('referer') referer: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const output = await this.platform.refresh(
      readCookie(request.header('cookie'), 'vinops_refresh'),
      csrfToken,
      origin,
      referer,
      request.vinopsCorrelationId,
    );
    response.setHeader('Set-Cookie', output.refresh_cookie);
    response.setHeader('Cache-Control', 'no-store');
    return sessionResponse(output);
  }

  @Delete('auth/sessions/:sessionId')
  @HttpCode(204)
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.platform.revokeSession(
      await this.identity(request),
      sessionId,
      request.vinopsCorrelationId,
    );
  }

  @Delete('auth/sessions')
  @HttpCode(204)
  async revokeAll(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.platform.revokeAllSessions(
      await this.identity(request),
      request.vinopsCorrelationId,
    );
    response.setHeader('Set-Cookie', this.platform.refreshCookieClear());
  }

  @Post('auth/password-resets')
  @HttpCode(202)
  async requestPasswordReset(
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<{ status: 'accepted' }> {
    const input = bodyRecord(body);
    await this.platform.requestPasswordReset(
      requiredString(input, 'email'),
      request.ip ?? 'unknown',
      request.vinopsCorrelationId,
    );
    return { status: 'accepted' };
  }

  @Post('auth/password-resets/confirm')
  @HttpCode(204)
  async confirmPasswordReset(@Body() body: unknown, @Req() request: Request): Promise<void> {
    const input = bodyRecord(body);
    await this.platform.confirmPasswordReset(
      requiredString(input, 'token'),
      requiredString(input, 'password'),
      request.vinopsCorrelationId,
    );
  }

  @Get('organizations')
  async listOrganizations(
    @Req() request: Request,
  ): Promise<{ items: readonly unknown[]; page: Record<string, unknown> }> {
    const items = await this.platform.listOrganizations(
      await this.identity(request),
      request.vinopsCorrelationId,
    );
    return this.page(items);
  }

  @Post('organizations')
  async createOrganization(@Body() body: unknown, @Req() request: Request): Promise<unknown> {
    const input = bodyRecord(body);
    return this.platform.createOrganization(
      await this.identity(request),
      { code: requiredString(input, 'code'), name: requiredString(input, 'name') },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('organizations/:organizationId/members')
  async listOrganizationMembers(
    @Param('organizationId') organizationId: string,
    @Req() request: Request,
  ): Promise<{ items: readonly unknown[]; page: Record<string, unknown> }> {
    return this.page(
      await this.platform.listOrganizationMembers(
        await this.identity(request),
        organizationId,
        request.vinopsCorrelationId,
      ),
    );
  }

  @Post('organizations/:organizationId/members')
  async addOrganizationMember(
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.platform.addOrganizationMember(
      await this.identity(request),
      organizationId,
      { userId: requiredString(input, 'user_id'), roles: stringArray(input, 'roles') },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('organizations/:organizationId/projects')
  async listProjects(
    @Param('organizationId') organizationId: string,
    @Req() request: Request,
  ): Promise<{ items: readonly unknown[]; page: Record<string, unknown> }> {
    return this.page(
      await this.platform.listProjects(
        await this.identity(request),
        organizationId,
        request.vinopsCorrelationId,
      ),
    );
  }

  @Post('organizations/:organizationId/projects')
  async createProject(
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.platform.createProject(
      await this.identity(request),
      organizationId,
      {
        code: requiredString(input, 'code'),
        name: requiredString(input, 'name'),
        timezone: requiredString(input, 'timezone'),
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId')
  async projectDetail(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.platform.projectDetail(
      await this.identity(request),
      projectId,
      request.vinopsCorrelationId,
    );
  }

  @Post('projects/:projectId/transitions')
  @HttpCode(200)
  async transitionProject(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.platform.transitionProject(
      await this.identity(request),
      projectId,
      {
        action: requiredString(input, 'action') as
          'activate' | 'suspend' | 'resume' | 'start_archive' | 'complete_archive' | 'restore',
        expectedVersion: requiredString(input, 'expected_version'),
        idempotencyKey: idempotencyKey(request),
        reason: optionalString(input, 'reason'),
      },
      request.vinopsCorrelationId,
    );
  }

  @Post('projects/:projectId/invitations')
  async createInvitation(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.platform.createInvitation(
      await this.identity(request),
      projectId,
      {
        email: requiredString(input, 'email'),
        roles: stringArray(input, 'roles'),
        validTo: requiredString(input, 'valid_to'),
        scopes: unknownArray(input, 'scopes'),
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('invitations/:token/accept')
  @HttpCode(200)
  async acceptInvitation(@Param('token') token: string, @Req() request: Request): Promise<unknown> {
    return this.platform.acceptInvitation(
      await this.identity(request),
      token,
      request.vinopsCorrelationId,
    );
  }

  @Delete('projects/:projectId/invitations/:invitationId')
  @HttpCode(204)
  async revokeInvitation(
    @Param('projectId') projectId: string,
    @Param('invitationId') invitationId: string,
    @Req() request: Request,
  ): Promise<void> {
    await this.platform.revokeInvitation(
      await this.identity(request),
      projectId,
      invitationId,
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/members')
  async listMembers(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<{ items: readonly unknown[]; page: Record<string, unknown> }> {
    return this.page(
      await this.platform.listMembers(
        await this.identity(request),
        projectId,
        request.vinopsCorrelationId,
      ),
    );
  }

  @Patch('project-members/:membershipId')
  async updateMember(
    @Param('membershipId') membershipId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const statusValue = input.status;
    if (
      statusValue !== undefined &&
      statusValue !== 'Active' &&
      statusValue !== 'Suspended' &&
      statusValue !== 'Ended'
    ) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    return this.platform.updateMembership(
      await this.identity(request),
      membershipId,
      {
        roles: input.roles === undefined ? undefined : stringArray(input, 'roles'),
        status: statusValue,
        validTo: optionalString(input, 'valid_to'),
        expectedVersion: requiredString(input, 'expected_version'),
        reason: optionalString(input, 'reason'),
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/context')
  async projectContext(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.platform.projectContext(
      await this.identity(request),
      projectId,
      request.vinopsCorrelationId,
    );
  }

  @Post('projects/:projectId/context/:kind')
  async createContextEntity(
    @Param('projectId') projectId: string,
    @Param('kind') kind: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    if (
      ![
        'partner',
        'calendar',
        'numbering_profile',
        'location_node',
        'work_node',
        'discipline',
        'classification',
      ].includes(kind)
    ) {
      throw new PlatformError('RESOURCE_NOT_VISIBLE', 'errors.resourceNotVisible', 404, false);
    }
    return this.platform.createProjectContextEntity(
      await this.identity(request),
      projectId,
      kind as
        | 'partner'
        | 'calendar'
        | 'numbering_profile'
        | 'location_node'
        | 'work_node'
        | 'discipline'
        | 'classification',
      bodyRecord(body),
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('projects/:projectId/context-imports/preview')
  async previewCsv(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const targetType = requiredString(input, 'target_type');
    if (targetType !== 'location_nodes' && targetType !== 'work_nodes') {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    return this.platform.previewCsvImport(
      await this.identity(request),
      projectId,
      { targetType, csv: requiredString(input, 'csv'), idempotencyKey: idempotencyKey(request) },
      request.vinopsCorrelationId,
    );
  }

  @Post('projects/:projectId/context-imports/:importId/commit')
  @HttpCode(200)
  async commitCsv(
    @Param('projectId') projectId: string,
    @Param('importId') importId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.platform.commitCsvImport(
      await this.identity(request),
      projectId,
      importId,
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('projects/:projectId/delegations')
  async createDelegation(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.platform.createDelegation(
      await this.identity(request),
      projectId,
      {
        delegateeUserId: requiredString(input, 'delegatee_user_id'),
        scopeType: requiredString(input, 'scope_type'),
        scopeId: requiredString(input, 'scope_id'),
        actions: stringArray(input, 'actions'),
        validFrom: requiredString(input, 'valid_from'),
        validTo: requiredString(input, 'valid_to'),
        reason: requiredString(input, 'reason'),
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('projects/:projectId/break-glass-requests')
  async requestBreakGlass(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.platform.requestBreakGlass(
      await this.identity(request),
      projectId,
      {
        scopeType: requiredString(input, 'scope_type'),
        scopeId: requiredString(input, 'scope_id'),
        actions: stringArray(input, 'actions'),
        reason: requiredString(input, 'reason'),
        validFrom: requiredString(input, 'valid_from'),
        validTo: requiredString(input, 'valid_to'),
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('break-glass-requests/:requestId/approve')
  @HttpCode(200)
  async approveBreakGlass(
    @Param('requestId') requestId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.platform.approveBreakGlass(
      await this.identity(request),
      requestId,
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('break-glass-requests/:requestId/sessions')
  async startBreakGlassSession(
    @Param('requestId') requestId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.platform.startBreakGlassSession(
      await this.identity(request),
      requestId,
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/documents')
  async listDocuments(
    @Param('projectId') projectId: string,
    @Query('search') search: string | undefined,
    @Query('include_archived') includeArchived: string | undefined,
    @Req() request: Request,
  ): Promise<{ items: readonly unknown[]; page: Record<string, unknown> }> {
    const items = await this.documents.listDocuments(
      await this.identity(request),
      projectId,
      search,
      includeArchived === 'true',
      request.vinopsCorrelationId,
    );
    return this.page(items);
  }

  @Post('projects/:projectId/documents')
  async createDocument(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, [
      'code',
      'title',
      'document_type',
      'numbering_context',
      'discipline_id',
      'classification_id',
      'work_id',
      'confidentiality',
    ]);
    const confidentiality = input.confidentiality;
    if (
      confidentiality !== undefined &&
      confidentiality !== 'internal' &&
      confidentiality !== 'restricted' &&
      confidentiality !== 'project'
    ) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    return this.documents.createDocument(
      await this.identity(request),
      projectId,
      {
        code: requiredString(input, 'code'),
        title: requiredString(input, 'title'),
        documentType: requiredString(input, 'document_type'),
        numberingContext: optionalString(input, 'numbering_context'),
        disciplineId: optionalString(input, 'discipline_id'),
        classificationId: optionalString(input, 'classification_id'),
        workId: optionalString(input, 'work_id'),
        confidentiality,
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('documents/:documentId')
  async documentDetail(
    @Param('documentId') documentId: string,
    @Query('revision_id') revisionId: string | undefined,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.documents.documentDetail(
      await this.identity(request),
      documentId,
      revisionId,
      request.vinopsCorrelationId,
    );
  }

  @Get('documents/:documentId/revisions')
  async documentRevisionHistory(
    @Param('documentId') documentId: string,
    @Req() request: Request,
  ): Promise<{ items: readonly unknown[]; page: Record<string, unknown> }> {
    const detail = await this.documents.documentDetail(
      await this.identity(request),
      documentId,
      undefined,
      request.vinopsCorrelationId,
    );
    const revisions = detail.revisions;
    return this.page(Array.isArray(revisions) ? revisions : []);
  }

  @Post('documents/:documentId/revisions')
  async createRevision(
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, ['revision_code', 'purpose', 'suitability_code', 'file']);
    const file = requiredRecord(input, 'file');
    allowKeys(file, ['filename', 'size_bytes', 'media_type', 'sha256']);
    return this.documents.createRevision(
      await this.identity(request),
      documentId,
      {
        revisionCode: requiredString(input, 'revision_code'),
        purpose: requiredString(input, 'purpose'),
        suitabilityCode: optionalString(input, 'suitability_code'),
        filename: requiredString(file, 'filename'),
        sizeBytes: requiredNumber(file, 'size_bytes'),
        mediaType: requiredString(file, 'media_type'),
        sha256: requiredString(file, 'sha256'),
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('upload-sessions/:uploadSessionId/parts/:partNumber/authorization')
  @HttpCode(200)
  async authorizeUploadPart(
    @Param('uploadSessionId') uploadSessionId: string,
    @Param('partNumber') partNumber: string,
    @Req() request: Request,
  ): Promise<unknown> {
    if (!/^\d+$/u.test(partNumber))
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    return this.documents.authorizeUploadPart(
      await this.identity(request),
      uploadSessionId,
      Number(partNumber),
      request.vinopsCorrelationId,
    );
  }

  @Post('upload-sessions/:uploadSessionId/complete')
  @HttpCode(202)
  async completeUpload(
    @Param('uploadSessionId') uploadSessionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, ['completed_parts', 'size_bytes', 'sha256']);
    const parts = nonEmptyRecordArray(input, 'completed_parts').map((part) => {
      allowKeys(part, ['part_number', 'etag']);
      return {
        partNumber: requiredNumber(part, 'part_number'),
        etag: requiredString(part, 'etag'),
      };
    });
    return this.documents.completeUpload(
      await this.identity(request),
      uploadSessionId,
      parts,
      requiredNumber(input, 'size_bytes'),
      requiredString(input, 'sha256'),
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('revisions/:revisionId/transitions')
  @HttpCode(200)
  async transitionRevision(
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, [
      'action',
      'expected_version',
      'expected_current_version',
      'distribution_context',
      'reason',
      'reviewer_ids',
      'review_mode',
      'required_approvals',
      'reject_threshold',
    ]);
    const reviewerIds =
      input.reviewer_ids === undefined ? undefined : uuidArray(input, 'reviewer_ids');
    const mode = input.review_mode;
    if (mode !== undefined && mode !== 'sequential' && mode !== 'quorum') {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    return this.documents.transitionRevision(
      await this.identity(request),
      revisionId,
      {
        action: revisionAction(requiredString(input, 'action')),
        expectedVersion: requiredString(input, 'expected_version'),
        expectedCurrentVersion: optionalNonNegativeIntegerString(input, 'expected_current_version'),
        contextKey: optionalString(input, 'distribution_context'),
        reason: optionalString(input, 'reason'),
        reviewerIds,
        reviewMode: mode,
        requiredApprovals: optionalNumber(input, 'required_approvals'),
        rejectThreshold: optionalNumber(input, 'reject_threshold'),
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('revisions/:revisionId/comments')
  async addReviewComment(
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, ['importance', 'body', 'page', 'x', 'y']);
    const importance = input.importance;
    if (importance !== 'mandatory' && importance !== 'advisory') {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    const commentInput: {
      importance: 'mandatory' | 'advisory';
      body: string;
      page?: number | undefined;
      x?: number | undefined;
      y?: number | undefined;
    } = {
      importance,
      body: requiredString(input, 'body'),
      ...(optionalNumber(input, 'page') === undefined
        ? {}
        : { page: optionalNumber(input, 'page') }),
      ...(optionalNumber(input, 'x') === undefined ? {} : { x: optionalNumber(input, 'x') }),
      ...(optionalNumber(input, 'y') === undefined ? {} : { y: optionalNumber(input, 'y') }),
    };
    return this.documents.addReviewComment(
      await this.identity(request),
      revisionId,
      commentInput,
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('review-comments/:commentId/dispositions')
  async disposeReviewComment(
    @Param('commentId') commentId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, ['disposition', 'response']);
    const disposition = requiredString(input, 'disposition');
    if (!['accepted', 'incorporated', 'noted', 'rejected_with_reason'].includes(disposition)) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    return this.documents.disposeReviewComment(
      await this.identity(request),
      commentId,
      { disposition, response: requiredString(input, 'response') },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('revisions/:revisionId/annotations')
  async addAnnotation(
    @Param('revisionId') revisionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, ['page', 'x', 'y', 'kind', 'body', 'linked_entity_type', 'linked_entity_id']);
    const kind = requiredString(input, 'kind');
    if (!['pin', 'note', 'highlight', 'area'].includes(kind)) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    const annotationInput = {
      page: requiredNumber(input, 'page'),
      x: requiredNumber(input, 'x'),
      y: requiredNumber(input, 'y'),
      kind,
      ...(optionalString(input, 'body') === undefined
        ? {}
        : { body: optionalString(input, 'body') }),
      ...(optionalString(input, 'linked_entity_type') === undefined
        ? {}
        : { linkedEntityType: optionalString(input, 'linked_entity_type') }),
      ...(optionalString(input, 'linked_entity_id') === undefined
        ? {}
        : { linkedEntityId: optionalString(input, 'linked_entity_id') }),
    };
    return this.documents.addAnnotation(
      await this.identity(request),
      revisionId,
      annotationInput,
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('revisions/:revisionId/preview')
  async previewRevision(
    @Param('revisionId') revisionId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.documents.authorizeFileAccess(
      await this.identity(request),
      revisionId,
      'preview',
      request.vinopsCorrelationId,
    );
  }

  @Get('revisions/:revisionId/download')
  async downloadRevision(
    @Param('revisionId') revisionId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.documents.authorizeFileAccess(
      await this.identity(request),
      revisionId,
      'download',
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/review-inbox')
  async reviewInbox(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<{ items: readonly unknown[]; page: Record<string, unknown> }> {
    return this.page(
      await this.documents.reviewInbox(
        await this.identity(request),
        projectId,
        request.vinopsCorrelationId,
      ),
    );
  }

  @Post('projects/:projectId/transmittals')
  async createTransmittal(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, ['code', 'purpose', 'items', 'recipients']);
    const items = nonEmptyRecordArray(input, 'items').map((item) => {
      allowKeys(item, ['revision_id', 'distribution_context']);
      const revisionId = requiredString(item, 'revision_id');
      const contextKey = optionalString(item, 'distribution_context');
      return contextKey === undefined ? { revisionId } : { revisionId, contextKey };
    });
    const recipients = nonEmptyRecordArray(input, 'recipients').map((recipient) => {
      allowKeys(recipient, ['type', 'reference', 'name', 'address']);
      const type = requiredString(recipient, 'type');
      let recipientType: 'user' | 'organization' | 'external';
      switch (type) {
        case 'user':
        case 'organization':
        case 'external':
          recipientType = type;
          break;
        default:
          throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
      }
      const address = optionalString(recipient, 'address');
      return address === undefined
        ? {
            type: recipientType,
            reference: requiredString(recipient, 'reference'),
            name: requiredString(recipient, 'name'),
          }
        : {
            type: recipientType,
            reference: requiredString(recipient, 'reference'),
            name: requiredString(recipient, 'name'),
            address,
          };
    });
    return this.documents.createTransmittal(
      await this.identity(request),
      projectId,
      {
        code: requiredString(input, 'code'),
        purpose: requiredString(input, 'purpose'),
        items,
        recipients,
      },
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Get('transmittals/:transmittalId')
  async transmittalDetail(
    @Param('transmittalId') transmittalId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.documents.transmittalDetail(
      await this.identity(request),
      transmittalId,
      request.vinopsCorrelationId,
    );
  }

  @Post('documents/:documentId/archive')
  @HttpCode(200)
  async archiveDocument(
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, ['expected_version']);
    return this.documents.setDocumentArchived(
      await this.identity(request),
      documentId,
      true,
      requiredString(input, 'expected_version'),
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  @Post('documents/:documentId/restore')
  @HttpCode(200)
  async restoreDocument(
    @Param('documentId') documentId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    allowKeys(input, ['expected_version']);
    return this.documents.setDocumentArchived(
      await this.identity(request),
      documentId,
      false,
      requiredString(input, 'expected_version'),
      idempotencyKey(request),
      request.vinopsCorrelationId,
    );
  }

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }

  private page(items: readonly unknown[]): {
    items: readonly unknown[];
    page: Record<string, unknown>;
  } {
    return { items, page: { next_cursor: null, has_more: false } };
  }
}
