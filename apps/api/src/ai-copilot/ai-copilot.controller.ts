import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import {
  AiCopilotService,
  type ReviewDetectionDto,
  type SubmitVisionAnalysisDto,
} from './ai-copilot.service.js';

type Request = CorrelatedRequest;

function bodyRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return body as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

@Controller('api/v1/projects/:projectId')
export class AiCopilotController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(AiCopilotService) private readonly aiService: AiCopilotService,
  ) {}

  @Post('ai/vision/analyze')
  @HttpCode(202)
  async submitVisionAnalysis(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);

    const data = await this.aiService.submitVisionAnalysis(
      identity,
      projectId,
      {
        fileId: requiredString(input, 'fileId'),
        sourceType: (input['sourceType'] as SubmitVisionAnalysisDto['sourceType']) ?? 'standalone',
        sourceEntityId: optionalString(input, 'sourceEntityId'),
        modelName: optionalString(input, 'modelName'),
      },
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  @Get('ai/vision/jobs/:jobId')
  async getVisionJob(
    @Param('projectId') projectId: string,
    @Param('jobId') jobId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const data = await this.aiService.getVisionJob(
      identity,
      projectId,
      jobId,
      request.vinopsCorrelationId,
    );
    return { success: true, data };
  }

  @Patch('ai/detections/:detectionId/review')
  async reviewDetection(
    @Param('projectId') projectId: string,
    @Param('detectionId') detectionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);

    const reviewStatus = requiredString(
      input,
      'reviewStatus',
    ) as ReviewDetectionDto['reviewStatus'];
    const data = await this.aiService.reviewDetection(
      identity,
      projectId,
      detectionId,
      {
        reviewStatus,
        createFieldIssue: Boolean(input['createFieldIssue']),
        issueTitle: optionalString(input, 'issueTitle'),
        severity: optionalString(input, 'severity'),
        assignedPartnerId: optionalString(input, 'assignedPartnerId'),
        linkedFieldIssueId: optionalString(input, 'linkedFieldIssueId'),
      },
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  @Post('ai/copilot/ask')
  @HttpCode(200)
  async askCopilot(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const question = requiredString(input, 'question');
    const identity = await this.identity(request);

    const data = await this.aiService.askCopilot(
      identity,
      projectId,
      question,
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  @Post('rfis/:rfiId/ai/suggest')
  @HttpCode(201)
  async suggestRfi(
    @Param('projectId') projectId: string,
    @Param('rfiId') rfiId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const data = await this.aiService.suggestRfiResponse(
      identity,
      projectId,
      rfiId,
      request.vinopsCorrelationId,
    );
    return { success: true, data };
  }

  @Get('rfis/:rfiId/ai/suggestions')
  async listRfiSuggestions(
    @Param('projectId') projectId: string,
    @Param('rfiId') rfiId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const data = await this.aiService.listRfiSuggestions(
      identity,
      projectId,
      rfiId,
      request.vinopsCorrelationId,
    );
    return { success: true, data };
  }

  @Patch('ai/suggestions/:suggestionId')
  async reviewRfiSuggestion(
    @Param('projectId') projectId: string,
    @Param('suggestionId') suggestionId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    const status = requiredString(input, 'status') as 'accepted' | 'rejected';
    const finalContent = optionalString(input, 'finalContent');

    const data = await this.aiService.reviewRfiSuggestion(
      identity,
      projectId,
      suggestionId,
      status,
      finalContent,
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }
}
