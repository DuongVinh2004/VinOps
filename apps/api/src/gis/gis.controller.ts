import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { PlatformError } from '../platform-error.js';
import { PlatformService, type RequestIdentity } from '../platform.service.js';
import type { CorrelatedRequest } from '../request-context.js';
import { GisService } from './gis.service.js';

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

// 1x1 Transparent PNG pixel buffer for fallback/simulated COG tiles
const TRANSPARENT_PNG_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

@Controller('api/v1/projects/:projectId')
export class GisController {
  constructor(
    @Inject(PlatformService) private readonly platform: PlatformService,
    @Inject(GisService) private readonly gisService: GisService,
  ) {}

  // --- 1. GIS Project Settings ---
  @Get('gis/settings')
  async getSettings(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const data = await this.gisService.getProjectSettings(
      identity,
      projectId,
      request.vinopsCorrelationId,
    );
    return { data };
  }

  @Post('gis/settings')
  async updateSettings(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    const data = await this.gisService.upsertProjectSettings(
      identity,
      projectId,
      {
        defaultCrsEpsg:
          input['defaultCrsEpsg'] !== undefined ? Number(input['defaultCrsEpsg']) : undefined,
        vn2000Zone: optionalString(input, 'vn2000Zone'),
        vn2000CentralMeridian:
          input['vn2000CentralMeridian'] !== undefined
            ? Number(input['vn2000CentralMeridian'])
            : undefined,
        projectCenterLat:
          input['projectCenterLat'] !== undefined ? Number(input['projectCenterLat']) : undefined,
        projectCenterLng:
          input['projectCenterLng'] !== undefined ? Number(input['projectCenterLng']) : undefined,
        defaultZoomLevel:
          input['defaultZoomLevel'] !== undefined ? Number(input['defaultZoomLevel']) : undefined,
        baseMapStyle: optionalString(input, 'baseMapStyle'),
        enableCadOverlay:
          input['enableCadOverlay'] !== undefined ? Boolean(input['enableCadOverlay']) : undefined,
        enableDroneOverlay:
          input['enableDroneOverlay'] !== undefined
            ? Boolean(input['enableDroneOverlay'])
            : undefined,
      },
      request.vinopsCorrelationId,
    );
    return { data };
  }

  // --- 2. GIS Layers ---
  @Get('gis/layers')
  async listLayers(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const data = await this.gisService.listLayers(identity, projectId, request.vinopsCorrelationId);
    return { data };
  }

  @Post('gis/layers')
  @HttpCode(201)
  async createLayer(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    const data = await this.gisService.createLayer(
      identity,
      projectId,
      {
        code: requiredString(input, 'code'),
        name: requiredString(input, 'name'),
        layerType: requiredString(input, 'layerType'),
        sourceType: requiredString(input, 'sourceType'),
        sourceFileId: optionalString(input, 'sourceFileId'),
        sourceUrl: optionalString(input, 'sourceUrl'),
        crsEpsg: input['crsEpsg'] !== undefined ? Number(input['crsEpsg']) : undefined,
        opacity: input['opacity'] !== undefined ? Number(input['opacity']) : undefined,
        zOrder: input['zOrder'] !== undefined ? Number(input['zOrder']) : undefined,
        visibleByDefault:
          input['visibleByDefault'] !== undefined ? Boolean(input['visibleByDefault']) : undefined,
        minZoom: input['minZoom'] !== undefined ? Number(input['minZoom']) : undefined,
        maxZoom: input['maxZoom'] !== undefined ? Number(input['maxZoom']) : undefined,
        styleConfig:
          typeof input['styleConfig'] === 'object' && input['styleConfig'] !== null
            ? (input['styleConfig'] as Record<string, unknown>)
            : undefined,
      },
      request.vinopsCorrelationId,
    );
    return { data };
  }

  // --- 3. Drone Flights ---
  @Get('drone/flights')
  async listFlights(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const data = await this.gisService.listDroneFlights(
      identity,
      projectId,
      request.vinopsCorrelationId,
    );
    return { data };
  }

  @Post('drone/flights')
  @HttpCode(201)
  async createFlight(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    const data = await this.gisService.createDroneFlight(
      identity,
      projectId,
      {
        code: requiredString(input, 'code'),
        name: requiredString(input, 'name'),
        flightDate: requiredString(input, 'flightDate'),
        pilotName: requiredString(input, 'pilotName'),
        droneModel: requiredString(input, 'droneModel'),
        cameraModel: requiredString(input, 'cameraModel'),
        gsdCm: input['gsdCm'] !== undefined ? Number(input['gsdCm']) : undefined,
        altitudeM: input['altitudeM'] !== undefined ? Number(input['altitudeM']) : undefined,
        overlapPct: input['overlapPct'] !== undefined ? Number(input['overlapPct']) : undefined,
        sidelapPct: input['sidelapPct'] !== undefined ? Number(input['sidelapPct']) : undefined,
        areaCoveredSqm:
          input['areaCoveredSqm'] !== undefined ? Number(input['areaCoveredSqm']) : undefined,
        photoCount: input['photoCount'] !== undefined ? Number(input['photoCount']) : undefined,
        rawDataSizeBytes:
          input['rawDataSizeBytes'] !== undefined ? Number(input['rawDataSizeBytes']) : undefined,
        processingSoftware: optionalString(input, 'processingSoftware'),
        crsEpsg: input['crsEpsg'] !== undefined ? Number(input['crsEpsg']) : undefined,
        flightBoundary:
          typeof input['flightBoundary'] === 'object' && input['flightBoundary'] !== null
            ? (input['flightBoundary'] as Record<string, unknown>)
            : { type: 'Polygon', coordinates: [] },
        notes: optionalString(input, 'notes'),
      },
      request.vinopsCorrelationId,
    );
    return { data };
  }

  // --- 4. Drone Orthophoto Upload & COG Conversion ---
  @Post('drone/flights/:flightId/orthophotos')
  @HttpCode(202)
  async uploadOrthophoto(
    @Param('projectId') projectId: string,
    @Param('flightId') flightId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    const data = await this.gisService.registerDroneOrthophoto(
      identity,
      projectId,
      flightId,
      {
        sourceFileId: requiredString(input, 'sourceFileId'),
        fileSizeBytes: Number(input['fileSizeBytes'] ?? 1024),
        crsEpsg: input['crsEpsg'] !== undefined ? Number(input['crsEpsg']) : undefined,
        boundsGeojson:
          typeof input['boundsGeojson'] === 'object' && input['boundsGeojson'] !== null
            ? (input['boundsGeojson'] as Record<string, unknown>)
            : { type: 'Polygon', coordinates: [] },
        resolutionM: input['resolutionM'] !== undefined ? Number(input['resolutionM']) : undefined,
        bandCount: input['bandCount'] !== undefined ? Number(input['bandCount']) : undefined,
        bitDepth: input['bitDepth'] !== undefined ? Number(input['bitDepth']) : undefined,
      },
      request.vinopsCorrelationId,
    );
    return { data };
  }

  // --- 5. COG Tile Dynamic Gateway Endpoint ---
  @Get('drone/flights/:flightId/orthophotos/:orthoId/tiles/:z/:x/:y.png')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  getCogTile(
    @Param('projectId') _projectId: string,
    @Param('flightId') _flightId: string,
    @Param('orthoId') _orthoId: string,
    @Param('z') _z: string,
    @Param('x') _x: string,
    @Param('y') _y: string,
    @Res() res: Response,
  ): void {
    // Sends the tile pixel raster buffer with immutable caching headers
    res.status(200).send(TRANSPARENT_PNG_TILE);
  }

  // --- 6. Spatial Annotations ---
  @Get('gis/annotations')
  async listAnnotations(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const data = await this.gisService.listSpatialAnnotations(
      identity,
      projectId,
      request.vinopsCorrelationId,
    );
    return { data };
  }

  @Post('gis/annotations')
  @HttpCode(201)
  async createAnnotation(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    const data = await this.gisService.createSpatialAnnotation(
      identity,
      projectId,
      {
        geometryType: requiredString(input, 'geometryType'),
        geometryGeojson:
          typeof input['geometryGeojson'] === 'object' && input['geometryGeojson'] !== null
            ? (input['geometryGeojson'] as Record<string, unknown>)
            : { type: 'Point', coordinates: [0, 0] },
        properties:
          typeof input['properties'] === 'object' && input['properties'] !== null
            ? (input['properties'] as Record<string, unknown>)
            : undefined,
        layerId: optionalString(input, 'layerId'),
        entityType: optionalString(input, 'entityType'),
        entityId: optionalString(input, 'entityId'),
        label: requiredString(input, 'label'),
        color: optionalString(input, 'color'),
      },
      request.vinopsCorrelationId,
    );
    return { data };
  }

  // --- 7. Survey Control Points ---
  @Get('gis/survey-points')
  async listSurveyPoints(
    @Param('projectId') projectId: string,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const identity = await this.identity(request);
    const data = await this.gisService.listSurveyControlPoints(
      identity,
      projectId,
      request.vinopsCorrelationId,
    );
    return { data };
  }

  @Post('gis/survey-points')
  @HttpCode(201)
  async createSurveyPoint(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    const data = await this.gisService.createSurveyControlPoint(
      identity,
      projectId,
      {
        code: requiredString(input, 'code'),
        name: requiredString(input, 'name'),
        pointType: requiredString(input, 'pointType'),
        latitude: Number(input['latitude']),
        longitude: Number(input['longitude']),
        elevationM: Number(input['elevationM']),
        vn2000X: input['vn2000X'] !== undefined ? Number(input['vn2000X']) : undefined,
        vn2000Y: input['vn2000Y'] !== undefined ? Number(input['vn2000Y']) : undefined,
        crsEpsg: input['crsEpsg'] !== undefined ? Number(input['crsEpsg']) : undefined,
        accuracyHMm: input['accuracyHMm'] !== undefined ? Number(input['accuracyHMm']) : undefined,
        accuracyVMm: input['accuracyVMm'] !== undefined ? Number(input['accuracyVMm']) : undefined,
        surveyDate: optionalString(input, 'surveyDate'),
        surveyorName: requiredString(input, 'surveyorName'),
        instrumentType: optionalString(input, 'instrumentType'),
      },
      request.vinopsCorrelationId,
    );
    return { data };
  }

  @Patch('gis/survey-points/:pointId')
  async updateSurveyPointStatus(
    @Param('projectId') projectId: string,
    @Param('pointId') pointId: string,
    @Body() body: unknown,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const input = bodyRecord(body);
    const identity = await this.identity(request);
    const status = requiredString(input, 'status') as 'active' | 'superseded' | 'destroyed';
    const notes = optionalString(input, 'notes');

    const data = await this.gisService.updateSurveyControlPointStatus(
      identity,
      projectId,
      pointId,
      status,
      notes,
      request.vinopsCorrelationId,
    );
    return { data };
  }

  private async identity(request: Request): Promise<RequestIdentity> {
    return this.platform.authenticate(request.header('authorization'), request.vinopsCorrelationId);
  }
}
