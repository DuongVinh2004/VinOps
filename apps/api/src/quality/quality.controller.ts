import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import { QualityService } from './quality.service.js';

type Request = CorrelatedRequest;

function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return body as Record<string, unknown>;
}

function parseSignatureData(body: Record<string, unknown>): string {
  const val = body['signature_data'];
  return typeof val === 'string' ? val : '';
}

@Controller('api/v1')
export class QualityController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(QualityService) private readonly quality: QualityService,
  ) {}

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }

  // --- Inspection Templates ---
  @Post('projects/:projectId/inspection-templates')
  @HttpCode(201)
  async createTemplate(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.createTemplate(
      await this.identity(request),
      projectId,
      input as unknown as Parameters<QualityService['createTemplate']>[2],
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/inspection-templates')
  async listTemplates(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.quality.listTemplates(
      await this.identity(request),
      projectId,
      request.vinopsCorrelationId,
    );
  }

  // --- Inspections ---
  @Post('projects/:projectId/inspections')
  @HttpCode(201)
  async createInspection(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.createInspection(
      await this.identity(request),
      projectId,
      input as unknown as Parameters<QualityService['createInspection']>[2],
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/inspections')
  async listInspections(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.quality.listInspections(
      await this.identity(request),
      projectId,
      request.vinopsCorrelationId,
    );
  }

  @Get('inspections/:inspectionId')
  async getInspection(
    @Param('inspectionId') inspectionId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.quality.getInspection(
      await this.identity(request),
      inspectionId,
      request.vinopsCorrelationId,
    );
  }

  @Put('inspections/:inspectionId/results/:itemKey')
  async saveResult(
    @Param('inspectionId') inspectionId: string,
    @Param('itemKey') itemKey: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.saveResult(
      await this.identity(request),
      inspectionId,
      itemKey,
      input as unknown as Parameters<QualityService['saveResult']>[3],
      request.vinopsCorrelationId,
    );
  }

  // --- Findings & CAR ---
  @Post('inspections/:inspectionId/findings')
  @HttpCode(201)
  async createFinding(
    @Param('inspectionId') inspectionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.createFinding(
      await this.identity(request),
      inspectionId,
      input as unknown as Parameters<QualityService['createFinding']>[2],
      request.vinopsCorrelationId,
    );
  }

  @Post('findings/:findingId/corrections')
  @HttpCode(201)
  async submitCorrection(
    @Param('findingId') findingId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.submitCorrection(
      await this.identity(request),
      findingId,
      input as unknown as Parameters<QualityService['submitCorrection']>[2],
      request.vinopsCorrelationId,
    );
  }

  @Post('findings/:findingId/transitions')
  async transitionFinding(
    @Param('findingId') findingId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.transitionFinding(
      await this.identity(request),
      findingId,
      input as unknown as Parameters<QualityService['transitionFinding']>[2],
      request.vinopsCorrelationId,
    );
  }

  // --- 3-Party Acceptance Records ---
  @Post('projects/:projectId/acceptance-records')
  @HttpCode(201)
  async createAcceptanceRecord(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.createAcceptanceRecord(
      await this.identity(request),
      projectId,
      input as unknown as Parameters<QualityService['createAcceptanceRecord']>[2],
      request.vinopsCorrelationId,
    );
  }

  @Get('projects/:projectId/acceptance-records')
  async listAcceptanceRecords(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.quality.listAcceptanceRecords(
      await this.identity(request),
      projectId,
      request.vinopsCorrelationId,
    );
  }

  @Get('acceptance-records/:acceptanceRecordId')
  async getAcceptanceRecord(
    @Param('acceptanceRecordId') recordId: string,
    @Req() request: Request,
  ): Promise<unknown> {
    return this.quality.getAcceptanceRecord(
      await this.identity(request),
      recordId,
      request.vinopsCorrelationId,
    );
  }

  @Post('acceptance-records/:acceptanceRecordId/sign-contractor')
  async signContractor(
    @Param('acceptanceRecordId') recordId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.signAcceptanceContractor(
      await this.identity(request),
      recordId,
      parseSignatureData(input),
      request.vinopsCorrelationId,
    );
  }

  @Post('acceptance-records/:acceptanceRecordId/sign-supervisor')
  async signSupervisor(
    @Param('acceptanceRecordId') recordId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.signAcceptanceSupervisor(
      await this.identity(request),
      recordId,
      parseSignatureData(input),
      request.vinopsCorrelationId,
    );
  }

  @Post('acceptance-records/:acceptanceRecordId/sign-pmu')
  async signPmu(
    @Param('acceptanceRecordId') recordId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<unknown> {
    const input = bodyRecord(body);
    return this.quality.signAcceptancePmu(
      await this.identity(request),
      recordId,
      parseSignatureData(input),
      request.vinopsCorrelationId,
    );
  }
}
