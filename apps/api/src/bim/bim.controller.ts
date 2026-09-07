import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req } from '@nestjs/common';
import type { BimDiscipline, BimEntityType } from '@vinops/domain';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import { BimService } from './bim.service.js';

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

@Controller()
export class BimController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(BimService) private readonly bimService: BimService,
  ) {}

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }

  // 1. Create / Upload BIM Model
  @Post(['api/v1/projects/:projectId/bim/models', 'projects/:projectId/bim/models'])
  @HttpCode(201)
  async createModel(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const code = requiredString(input, 'code');
    const name = requiredString(input, 'name');
    const discipline = (optionalString(input, 'discipline') ?? 'structural') as BimDiscipline;
    const crsEpsg = input['crsEpsg'] !== undefined ? Number(input['crsEpsg']) : undefined;

    const data = await this.bimService.createModel(
      await this.identity(request),
      projectId,
      {
        code,
        name,
        discipline,
        ...(crsEpsg !== undefined ? { crsEpsg } : {}),
      },
      undefined,
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 2. List BIM Models
  @Get(['api/v1/projects/:projectId/bim/models', 'projects/:projectId/bim/models'])
  async listModels(
    @Param('projectId') projectId: string,
    @Query('status') status: string | undefined,
    @Query('discipline') discipline: string | undefined,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const data = await this.bimService.listModels(
      await this.identity(request),
      projectId,
      { status, discipline },
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 3. Get Model Detail
  @Get([
    'api/v1/projects/:projectId/bim/models/:modelId',
    'projects/:projectId/bim/models/:modelId',
  ])
  async getModel(
    @Param('projectId') projectId: string,
    @Param('modelId') modelId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const data = await this.bimService.getModel(
      await this.identity(request),
      projectId,
      modelId,
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 4. Get Model Rendering Manifest
  @Get([
    'api/v1/projects/:projectId/bim/models/:modelId/manifest',
    'projects/:projectId/bim/models/:modelId/manifest',
  ])
  async getManifest(
    @Param('projectId') projectId: string,
    @Param('modelId') modelId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const data = await this.bimService.getManifest(
      await this.identity(request),
      projectId,
      modelId,
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 5. Get Element by IFC GUID
  @Get(['api/v1/projects/:projectId/bim/elements', 'projects/:projectId/bim/elements'])
  async getElement(
    @Param('projectId') projectId: string,
    @Query('ifcGuid') ifcGuid: string | undefined,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    if (!ifcGuid || ifcGuid.trim().length === 0) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }

    const data = await this.bimService.getElementByGuid(
      await this.identity(request),
      projectId,
      ifcGuid.trim(),
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 6. Get Links for Element
  @Get([
    'api/v1/projects/:projectId/bim/elements/:ifcGuid/links',
    'projects/:projectId/bim/elements/:ifcGuid/links',
  ])
  async getElementLinks(
    @Param('projectId') projectId: string,
    @Param('ifcGuid') ifcGuid: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const data = await this.bimService.getElementLinks(
      await this.identity(request),
      projectId,
      ifcGuid,
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 7. Create Link between Element and Field Entity
  @Post([
    'api/v1/projects/:projectId/bim/elements/:ifcGuid/links',
    'projects/:projectId/bim/elements/:ifcGuid/links',
  ])
  @HttpCode(201)
  async createElementLink(
    @Param('projectId') projectId: string,
    @Param('ifcGuid') ifcGuid: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const modelId = requiredString(input, 'modelId');
    const entityType = requiredString(input, 'entityType') as BimEntityType;
    const entityId = requiredString(input, 'entityId');

    const data = await this.bimService.createElementLink(
      await this.identity(request),
      projectId,
      ifcGuid,
      { modelId, entityType, entityId },
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 8. Save BCF Viewpoint
  @Post(['api/v1/projects/:projectId/bim/viewpoints', 'projects/:projectId/bim/viewpoints'])
  @HttpCode(201)
  async saveViewpoint(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const modelId = requiredString(input, 'modelId');
    const title = requiredString(input, 'title');
    const cameraData = bodyRecord(input['cameraData']);
    const clippingPlanes = Array.isArray(input['clippingPlanes']) ? input['clippingPlanes'] : [];

    const fieldIssueId = optionalString(input, 'fieldIssueId');
    const snapshotFileId = optionalString(input, 'snapshotFileId');

    const data = await this.bimService.saveViewpoint(
      await this.identity(request),
      projectId,
      {
        modelId,
        title,
        cameraData,
        clippingPlanes,
        highlightedGuids: Array.isArray(input['highlightedGuids'])
          ? (input['highlightedGuids'] as string[])
          : [],
        hiddenGuids: Array.isArray(input['hiddenGuids']) ? (input['hiddenGuids'] as string[]) : [],
        ...(snapshotFileId ? { snapshotFileId } : {}),
        ...(fieldIssueId ? { fieldIssueId } : {}),
      },
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 9. List Viewpoints
  @Get(['api/v1/projects/:projectId/bim/viewpoints', 'projects/:projectId/bim/viewpoints'])
  async listViewpoints(
    @Param('projectId') projectId: string,
    @Query('modelId') modelId: string | undefined,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const data = await this.bimService.listViewpoints(
      await this.identity(request),
      projectId,
      modelId,
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }

  // 10. Get Viewpoint Detail
  @Get([
    'api/v1/projects/:projectId/bim/viewpoints/:viewpointId',
    'projects/:projectId/bim/viewpoints/:viewpointId',
  ])
  async getViewpoint(
    @Param('projectId') projectId: string,
    @Param('viewpointId') viewpointId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const data = await this.bimService.getViewpoint(
      await this.identity(request),
      projectId,
      viewpointId,
      request.vinopsCorrelationId,
    );

    return { success: true, data };
  }
}
