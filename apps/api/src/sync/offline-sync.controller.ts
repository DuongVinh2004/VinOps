import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import { OfflineSyncService } from './offline-sync.service.js';

type Request = CorrelatedRequest;

function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return body as Record<string, unknown>;
}

@Controller('api/v1')
export class OfflineSyncController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(OfflineSyncService) private readonly sync: OfflineSyncService,
  ) {}

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }

  @Post('projects/:projectId/sync/batches')
  @HttpCode(200)
  async ingestBatch(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.sync.ingestBatch(
      await this.identity(request),
      projectId,
      input as unknown as Parameters<OfflineSyncService['ingestBatch']>[2],
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/changes')
  async getChanges(
    @Param('projectId') projectId: string,
    @Query('cursor') cursor: string | undefined,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.sync.getChanges(
      await this.identity(request),
      projectId,
      cursor,
      request.vinopsCorrelationId,
    );
  }
}
