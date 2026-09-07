import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type {
  RfiAction,
  RfiPriority,
  SubmittalAction,
  SubmittalReviewDecision,
  SubmittalReviewStage,
  SubmittalType,
} from '@vinops/domain';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import { RfxService, type CreateSubmittalItemInput } from './rfx.service.js';

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
export class RfxController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(RfxService) private readonly rfxService: RfxService,
  ) {}

  // ====================== RFI ENDPOINTS ======================

  @Get('rfis')
  async listRfis(
    @Param('projectId') projectId: string,
    @Query('status') status: string | undefined,
    @Query('ball_in_court_organization_id') ballInCourtOrganizationId: string | undefined,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const items = await this.rfxService.listRfis(
      identity,
      projectId,
      { status, ballInCourtOrganizationId },
      request.vinopsCorrelationId,
    );
    return { items, page: { next_cursor: null, has_more: false } };
  }

  @Post('rfis')
  @HttpCode(201)
  async createRfi(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);

    return this.rfxService.createRfi(
      identity,
      projectId,
      {
        code: requiredString(input, 'code'),
        title: requiredString(input, 'title'),
        question: requiredString(input, 'question'),
        suggestedSolution: optionalString(input, 'suggested_solution'),
        priority: optionalString(input, 'priority') as RfiPriority | undefined,
        locationNodeId: optionalString(input, 'location_node_id'),
        workNodeId: optionalString(input, 'work_node_id'),
        documentId: optionalString(input, 'document_id'),
        requestingPartnerOrganizationId: requiredString(
          input,
          'requesting_partner_organization_id',
        ),
        respondingPartnerOrganizationId: optionalString(
          input,
          'responding_partner_organization_id',
        ),
        sourceIssueId: optionalString(input, 'source_issue_id'),
        slaBusinessDays:
          input.sla_business_days !== undefined ? Number(input.sla_business_days) : undefined,
      },
      request.vinopsCorrelationId,
    );
  }

  @Get('rfis/:rfiId')
  async getRfi(
    @Param('projectId') projectId: string,
    @Param('rfiId') rfiId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    return this.rfxService.getRfi(identity, projectId, rfiId, request.vinopsCorrelationId);
  }

  @Post('rfis/:rfiId/transitions')
  @HttpCode(200)
  async transitionRfi(
    @Param('projectId') projectId: string,
    @Param('rfiId') rfiId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    return this.rfxService.transitionRfi(
      identity,
      projectId,
      rfiId,
      requiredString(input, 'action') as RfiAction,
      optionalString(input, 'comment'),
      request.vinopsCorrelationId,
    );
  }

  @Post('rfis/:rfiId/responses')
  @HttpCode(201)
  async createRfiResponse(
    @Param('projectId') projectId: string,
    @Param('rfiId') rfiId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    return this.rfxService.createRfiResponse(
      identity,
      projectId,
      rfiId,
      {
        responseType: requiredString(input, 'response_type') as
          'clarification_request' | 'clarification_answer' | 'official_answer',
        content: requiredString(input, 'content'),
        revisedDocumentId: optionalString(input, 'revised_document_id'),
        revisedDocumentRevisionId: optionalString(input, 'revised_document_revision_id'),
        fileId: optionalString(input, 'file_id'),
      },
      request.vinopsCorrelationId,
    );
  }

  // ====================== SUBMITTAL ENDPOINTS ======================

  @Get('submittals')
  async listSubmittals(
    @Param('projectId') projectId: string,
    @Query('status') status: string | undefined,
    @Query('submittal_type') submittalType: string | undefined,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const items = await this.rfxService.listSubmittals(
      identity,
      projectId,
      { status, submittalType },
      request.vinopsCorrelationId,
    );
    return { items, page: { next_cursor: null, has_more: false } };
  }

  @Post('submittals')
  @HttpCode(201)
  async createSubmittal(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);

    let items: CreateSubmittalItemInput[] | undefined;
    if (Array.isArray(input.items)) {
      items = (input.items as Record<string, unknown>[]).map((it, idx) => {
        const itemNumber = typeof it.item_number === 'number' ? it.item_number : idx + 1;
        const description = typeof it.description === 'string' ? it.description : '';
        const manufacturer =
          typeof it.manufacturer === 'string' && it.manufacturer.trim().length > 0
            ? it.manufacturer.trim()
            : undefined;
        const modelOrGrade =
          typeof it.model_or_grade === 'string' && it.model_or_grade.trim().length > 0
            ? it.model_or_grade.trim()
            : undefined;
        const sampleQuantity = typeof it.sample_quantity === 'number' ? it.sample_quantity : 1;
        const physicalSampleReceived = Boolean(it.physical_sample_received);
        const documentId =
          typeof it.document_id === 'string' && it.document_id.trim().length > 0
            ? it.document_id.trim()
            : undefined;
        const fileId =
          typeof it.file_id === 'string' && it.file_id.trim().length > 0
            ? it.file_id.trim()
            : undefined;

        return {
          itemNumber,
          description,
          ...(manufacturer !== undefined ? { manufacturer } : {}),
          ...(modelOrGrade !== undefined ? { modelOrGrade } : {}),
          sampleQuantity,
          physicalSampleReceived,
          ...(documentId !== undefined ? { documentId } : {}),
          ...(fileId !== undefined ? { fileId } : {}),
        };
      });
    }

    return this.rfxService.createSubmittal(
      identity,
      projectId,
      {
        code: requiredString(input, 'code'),
        title: requiredString(input, 'title'),
        submittalType: requiredString(input, 'submittal_type') as SubmittalType,
        makerPartnerOrganizationId: requiredString(input, 'maker_partner_organization_id'),
        leadContractorPartnerOrganizationId: optionalString(
          input,
          'lead_contractor_partner_organization_id',
        ),
        consultantPartnerOrganizationId: optionalString(
          input,
          'consultant_partner_organization_id',
        ),
        locationNodeId: optionalString(input, 'location_node_id'),
        workNodeId: optionalString(input, 'work_node_id'),
        specificationDocumentId: optionalString(input, 'specification_document_id'),
        drawingDocumentId: optionalString(input, 'drawing_document_id'),
        slaBusinessDays:
          input.sla_business_days !== undefined ? Number(input.sla_business_days) : undefined,
        items,
      },
      request.vinopsCorrelationId,
    );
  }

  @Get('submittals/:submittalId')
  async getSubmittal(
    @Param('projectId') projectId: string,
    @Param('submittalId') submittalId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    return this.rfxService.getSubmittal(
      identity,
      projectId,
      submittalId,
      request.vinopsCorrelationId,
    );
  }

  @Post('submittals/:submittalId/transitions')
  @HttpCode(200)
  async transitionSubmittal(
    @Param('projectId') projectId: string,
    @Param('submittalId') submittalId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    return this.rfxService.transitionSubmittal(
      identity,
      projectId,
      submittalId,
      requiredString(input, 'action') as SubmittalAction,
      optionalString(input, 'comment'),
      request.vinopsCorrelationId,
    );
  }

  @Post('submittals/:submittalId/reviews')
  @HttpCode(201)
  async createSubmittalReview(
    @Param('projectId') projectId: string,
    @Param('submittalId') submittalId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    return this.rfxService.createSubmittalReview(
      identity,
      projectId,
      submittalId,
      {
        stage: requiredString(input, 'stage') as SubmittalReviewStage,
        decision: requiredString(input, 'decision') as SubmittalReviewDecision,
        comments: requiredString(input, 'comments'),
        attachedFileId: optionalString(input, 'attached_file_id'),
      },
      request.vinopsCorrelationId,
    );
  }

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }
}
