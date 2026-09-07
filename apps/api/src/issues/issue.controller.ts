import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { IssueAction } from '@vinops/domain';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import { IssueService } from './issue.service.js';

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

@Controller('api/v1/projects/:projectId/issues')
export class IssueController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(IssueService) private readonly issueService: IssueService,
  ) {}

  @Get()
  async listIssues(
    @Param('projectId') projectId: string,
    @Query('status') status: string | undefined,
    @Query('severity') severity: string | undefined,
    @Query('location_node_id') locationNodeId: string | undefined,
    @Query('work_node_id') workNodeId: string | undefined,
    @Query('contractor_organization_id') contractorOrganizationId: string | undefined,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const items = await this.issueService.listIssues(
      identity,
      projectId,
      { status, severity, locationNodeId, workNodeId, contractorOrganizationId },
      request.vinopsCorrelationId,
    );
    return { items, page: { next_cursor: null, has_more: false } };
  }

  @Post()
  @HttpCode(201)
  async quickCreateIssue(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);

    let gps: { latitude: number; longitude: number; accuracyMeters?: number } | undefined;
    if (input.gps && typeof input.gps === 'object') {
      const g = input.gps as Record<string, unknown>;
      gps = {
        latitude: Number(g.latitude),
        longitude: Number(g.longitude),
      };
      if (g.accuracy_meters !== undefined && g.accuracy_meters !== null) {
        gps.accuracyMeters = Number(g.accuracy_meters);
      }
    }

    const attachmentFileIds = Array.isArray(input.attachment_file_ids)
      ? (input.attachment_file_ids as string[])
      : undefined;

    return this.issueService.quickCreateIssue(
      identity,
      projectId,
      {
        code: requiredString(input, 'code'),
        title: requiredString(input, 'title'),
        description: requiredString(input, 'description'),
        category: requiredString(input, 'category'),
        severity: requiredString(input, 'severity'),
        locationNodeId: optionalString(input, 'location_node_id'),
        workNodeId: optionalString(input, 'work_node_id'),
        contractorOrganizationId: optionalString(input, 'contractor_organization_id'),
        suggestedContractorOrganizationId: optionalString(
          input,
          'suggested_contractor_organization_id',
        ),
        assignedToUserId: optionalString(input, 'assigned_to_user_id'),
        gps,
        dueAt: optionalString(input, 'due_at'),
        attachmentFileIds,
      },
      request.vinopsCorrelationId,
    );
  }

  @Get(':issueId')
  async getIssue(
    @Param('projectId') projectId: string,
    @Param('issueId') issueId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    return this.issueService.getIssue(identity, projectId, issueId, request.vinopsCorrelationId);
  }

  @Post(':issueId/transitions')
  @HttpCode(200)
  async transitionIssue(
    @Param('projectId') projectId: string,
    @Param('issueId') issueId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    return this.issueService.transitionIssue(
      identity,
      projectId,
      issueId,
      {
        action: requiredString(input, 'action') as IssueAction,
        assignedToUserId: optionalString(input, 'assigned_to_user_id'),
        contractorOrganizationId: optionalString(input, 'contractor_organization_id'),
        comment: optionalString(input, 'comment'),
      },
      request.vinopsCorrelationId,
    );
  }

  @Post(':issueId/comments')
  @HttpCode(201)
  async addComment(
    @Param('projectId') projectId: string,
    @Param('issueId') issueId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    return this.issueService.addComment(
      identity,
      projectId,
      issueId,
      requiredString(input, 'content'),
      request.vinopsCorrelationId,
    );
  }

  @Post(':issueId/escalate-to-rfi')
  @HttpCode(201)
  async escalateToRfi(
    @Param('projectId') projectId: string,
    @Param('issueId') issueId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    return this.issueService.escalateToRfi(
      identity,
      projectId,
      issueId,
      {
        rfiCode: requiredString(input, 'rfi_code'),
        title: requiredString(input, 'title'),
        question: requiredString(input, 'question'),
        suggestedSolution: optionalString(input, 'suggested_solution'),
        priority: optionalString(input, 'priority'),
        requestingPartnerOrganizationId: requiredString(
          input,
          'requesting_partner_organization_id',
        ),
        respondingPartnerOrganizationId: optionalString(
          input,
          'responding_partner_organization_id',
        ),
        slaBusinessDays:
          input.sla_business_days !== undefined ? Number(input.sla_business_days) : undefined,
      },
      request.vinopsCorrelationId,
    );
  }

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }
}
