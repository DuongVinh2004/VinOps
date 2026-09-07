import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import {
  SigningService,
  type AddDossierItemInput,
  type CreateDossierInput,
  type InitSigningSessionInput,
  type RejectSigningInput,
} from './signing.service.js';
import type { SignableType } from '@vinops/domain';

type Request = CorrelatedRequest;

function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return body as Record<string, unknown>;
}

@Controller('api/v1')
export class SigningController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(SigningService) private readonly signing: SigningService,
  ) {}

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }

  @Post('projects/:projectId/signing/sessions')
  @HttpCode(201)
  async initSessions(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const result = await this.signing.initSigningSessions(
      await this.identity(request),
      projectId,
      input as unknown as InitSigningSessionInput,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }

  @Post('projects/:projectId/signing/sessions/:sessionId/authorize')
  async authorizeSession(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const result = await this.signing.authorizeSession(
      await this.identity(request),
      projectId,
      sessionId,
      input,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }

  @Post('projects/:projectId/signing/sessions/:sessionId/sign')
  async signSession(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const result = await this.signing.signSession(
      await this.identity(request),
      projectId,
      sessionId,
      input,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }

  @Post('projects/:projectId/signing/sessions/:sessionId/reject')
  async rejectSession(
    @Param('projectId') projectId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const result = await this.signing.rejectSession(
      await this.identity(request),
      projectId,
      sessionId,
      input as unknown as RejectSigningInput,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }

  @Get('projects/:projectId/signing/sessions')
  async listSessions(
    @Param('projectId') projectId: string,
    @Query('signableType') signableType: string,
    @Query('signableId') signableId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    if (!signableType || !signableId) {
      throw new PlatformError(
        'VALIDATION_FAILED',
        'signableType and signableId are required query parameters',
        422,
        false,
      );
    }
    const result = await this.signing.listSessions(
      await this.identity(request),
      projectId,
      signableType as SignableType,
      signableId,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }

  @Get('projects/:projectId/signatures/:signatureId/verify')
  async verifySignature(
    @Param('projectId') projectId: string,
    @Param('signatureId') signatureId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    const result = await this.signing.verifySignature(
      await this.identity(request),
      projectId,
      signatureId,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }

  @Post('projects/:projectId/dossiers')
  @HttpCode(201)
  async createDossier(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const result = await this.signing.createDossier(
      await this.identity(request),
      projectId,
      input as unknown as CreateDossierInput,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }

  @Post('projects/:projectId/dossiers/:dossierId/items')
  async addDossierItems(
    @Param('projectId') projectId: string,
    @Param('dossierId') dossierId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const items = (input['items'] as AddDossierItemInput[]) ?? [];
    const result = await this.signing.addDossierItems(
      await this.identity(request),
      projectId,
      dossierId,
      items,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }

  @Post('projects/:projectId/dossiers/:dossierId/seal')
  async sealDossier(
    @Param('projectId') projectId: string,
    @Param('dossierId') dossierId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    const result = await this.signing.sealDossier(
      await this.identity(request),
      projectId,
      dossierId,
      input,
      request.vinopsCorrelationId,
    );
    return { success: true, data: result };
  }
}
