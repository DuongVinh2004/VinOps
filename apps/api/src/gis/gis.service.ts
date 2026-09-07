import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';

type JsonRecord = Record<string, unknown>;

export type GisSettingsInput = {
  defaultCrsEpsg?: number | undefined;
  vn2000Zone?: string | undefined;
  vn2000CentralMeridian?: number | undefined;
  projectCenterLat?: number | undefined;
  projectCenterLng?: number | undefined;
  defaultZoomLevel?: number | undefined;
  baseMapStyle?: string | undefined;
  enableCadOverlay?: boolean | undefined;
  enableDroneOverlay?: boolean | undefined;
};

export type GisLayerInput = {
  code: string;
  name: string;
  layerType: string;
  sourceType: string;
  sourceFileId?: string | undefined;
  sourceUrl?: string | undefined;
  crsEpsg?: number | undefined;
  opacity?: number | undefined;
  zOrder?: number | undefined;
  visibleByDefault?: boolean | undefined;
  minZoom?: number | undefined;
  maxZoom?: number | undefined;
  styleConfig?: Record<string, unknown> | undefined;
};

export type DroneFlightInput = {
  code: string;
  name: string;
  flightDate: string;
  pilotName: string;
  droneModel: string;
  cameraModel: string;
  gsdCm?: number | undefined;
  altitudeM?: number | undefined;
  overlapPct?: number | undefined;
  sidelapPct?: number | undefined;
  areaCoveredSqm?: number | undefined;
  photoCount?: number | undefined;
  rawDataSizeBytes?: number | undefined;
  processingSoftware?: string | undefined;
  crsEpsg?: number | undefined;
  flightBoundary: Record<string, unknown>;
  notes?: string | undefined;
};

export type DroneOrthophotoInput = {
  sourceFileId: string;
  fileSizeBytes: number;
  crsEpsg?: number | undefined;
  boundsGeojson: Record<string, unknown>;
  resolutionM?: number | undefined;
  bandCount?: number | undefined;
  bitDepth?: number | undefined;
};

export type SpatialAnnotationInput = {
  geometryType: string;
  geometryGeojson: Record<string, unknown>;
  properties?: Record<string, unknown> | undefined;
  layerId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  label: string;
  color?: string | undefined;
};

export type SurveyControlPointInput = {
  code: string;
  name: string;
  pointType: string;
  latitude: number;
  longitude: number;
  elevationM: number;
  vn2000X?: number | undefined;
  vn2000Y?: number | undefined;
  crsEpsg?: number | undefined;
  accuracyHMm?: number | undefined;
  accuracyVMm?: number | undefined;
  surveyDate?: string | undefined;
  surveyorName: string;
  instrumentType?: string | undefined;
};

@Injectable()
export class GisService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(@Inject(API_CONFIG) config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-gis-api',
            runtimeRole: 'vinops_app',
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  // 1. GIS Project Settings
  async getProjectSettings(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<{
        id: string;
        organization_id: string;
        project_id: string;
        default_crs_epsg: number;
        vn2000_zone: string | null;
        vn2000_central_meridian: string | null;
        project_center_lat: string | null;
        project_center_lng: string | null;
        default_zoom_level: number;
        base_map_style: string;
        enable_cad_overlay: boolean;
        enable_drone_overlay: boolean;
        version: string;
        created_at: Date;
        updated_at: Date;
      }>(`SELECT * FROM vinops.gis_project_settings WHERE project_id = $1::uuid`, [projectId]);

      const s = rows[0];
      if (!s) {
        // Return default empty settings
        return {
          defaultCrsEpsg: 4326,
          vn2000Zone: 'zone_3_hcm',
          defaultZoomLevel: 15,
          baseMapStyle: 'satellite',
          enableCadOverlay: true,
          enableDroneOverlay: true,
        };
      }

      return {
        id: s.id,
        organizationId: s.organization_id,
        projectId: s.project_id,
        defaultCrsEpsg: s.default_crs_epsg,
        vn2000Zone: s.vn2000_zone,
        vn2000CentralMeridian: s.vn2000_central_meridian ? Number(s.vn2000_central_meridian) : null,
        projectCenterLat: s.project_center_lat ? Number(s.project_center_lat) : null,
        projectCenterLng: s.project_center_lng ? Number(s.project_center_lng) : null,
        defaultZoomLevel: s.default_zoom_level,
        baseMapStyle: s.base_map_style,
        enableCadOverlay: s.enable_cad_overlay,
        enableDroneOverlay: s.enable_drone_overlay,
        version: Number(s.version),
        createdAt: s.created_at.toISOString(),
        updatedAt: s.updated_at.toISOString(),
      };
    });
  }

  async upsertProjectSettings(
    identity: RequestIdentity,
    projectId: string,
    input: GisSettingsInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const id = randomUUID();

      const rows = await transaction.query<{
        id: string;
        organization_id: string;
        project_id: string;
        default_crs_epsg: number;
        vn2000_zone: string | null;
        vn2000_central_meridian: string | null;
        project_center_lat: string | null;
        project_center_lng: string | null;
        default_zoom_level: number;
        base_map_style: string;
        enable_cad_overlay: boolean;
        enable_drone_overlay: boolean;
        version: string;
        created_at: Date;
        updated_at: Date;
      }>(
        `INSERT INTO vinops.gis_project_settings (
          id, organization_id, project_id, default_crs_epsg,
          vn2000_zone, vn2000_central_meridian,
          project_center_lat, project_center_lng,
          default_zoom_level, base_map_style,
          enable_cad_overlay, enable_drone_overlay,
          created_by, created_at, updated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4,
          $5, $6,
          $7, $8,
          $9, $10,
          $11, $12,
          $13::uuid, now(), now()
        )
        ON CONFLICT (project_id) DO UPDATE
          SET default_crs_epsg = COALESCE($4, gis_project_settings.default_crs_epsg),
              vn2000_zone = COALESCE($5, gis_project_settings.vn2000_zone),
              vn2000_central_meridian = COALESCE($6, gis_project_settings.vn2000_central_meridian),
              project_center_lat = COALESCE($7, gis_project_settings.project_center_lat),
              project_center_lng = COALESCE($8, gis_project_settings.project_center_lng),
              default_zoom_level = COALESCE($9, gis_project_settings.default_zoom_level),
              base_map_style = COALESCE($10, gis_project_settings.base_map_style),
              enable_cad_overlay = COALESCE($11, gis_project_settings.enable_cad_overlay),
              enable_drone_overlay = COALESCE($12, gis_project_settings.enable_drone_overlay),
              updated_at = now()
        RETURNING *`,
        [
          id,
          orgId,
          projectId,
          input.defaultCrsEpsg ?? 4326,
          input.vn2000Zone ?? 'zone_3_hcm',
          input.vn2000CentralMeridian ?? 105.75,
          input.projectCenterLat ?? null,
          input.projectCenterLng ?? null,
          input.defaultZoomLevel ?? 15,
          input.baseMapStyle ?? 'satellite',
          input.enableCadOverlay ?? true,
          input.enableDroneOverlay ?? true,
          identity.userId,
        ],
      );

      const s = rows[0]!;
      return {
        id: s.id,
        organizationId: s.organization_id,
        projectId: s.project_id,
        defaultCrsEpsg: s.default_crs_epsg,
        vn2000Zone: s.vn2000_zone,
        vn2000CentralMeridian: s.vn2000_central_meridian ? Number(s.vn2000_central_meridian) : null,
        projectCenterLat: s.project_center_lat ? Number(s.project_center_lat) : null,
        projectCenterLng: s.project_center_lng ? Number(s.project_center_lng) : null,
        defaultZoomLevel: s.default_zoom_level,
        baseMapStyle: s.base_map_style,
        enableCadOverlay: s.enable_cad_overlay,
        enableDroneOverlay: s.enable_drone_overlay,
        version: Number(s.version),
        createdAt: s.created_at.toISOString(),
        updatedAt: s.updated_at.toISOString(),
      };
    });
  }

  // 2. GIS Layers
  async listLayers(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<{
        id: string;
        organization_id: string;
        project_id: string;
        code: string;
        name: string;
        layer_type: string;
        source_type: string;
        source_file_id: string | null;
        source_url: string | null;
        crs_epsg: number;
        opacity: string;
        z_order: number;
        visible_by_default: boolean;
        style_config: JsonRecord;
        status: string;
        version: string;
        created_at: Date;
        updated_at: Date;
      }>(`SELECT * FROM vinops.gis_layers WHERE project_id = $1::uuid ORDER BY z_order ASC`, [
        projectId,
      ]);

      return rows.map((l) => ({
        id: l.id,
        organizationId: l.organization_id,
        projectId: l.project_id,
        code: l.code,
        name: l.name,
        layerType: l.layer_type,
        sourceType: l.source_type,
        sourceFileId: l.source_file_id,
        sourceUrl: l.source_url,
        crsEpsg: l.crs_epsg,
        opacity: Number(l.opacity),
        zOrder: l.z_order,
        visibleByDefault: l.visible_by_default,
        styleConfig: l.style_config ?? {},
        status: l.status,
        version: Number(l.version),
        createdAt: l.created_at.toISOString(),
        updatedAt: l.updated_at.toISOString(),
      }));
    });
  }

  async createLayer(
    identity: RequestIdentity,
    projectId: string,
    input: GisLayerInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const id = randomUUID();

      const rows = await transaction.query<{
        id: string;
        code: string;
        name: string;
        status: string;
        created_at: Date;
      }>(
        `INSERT INTO vinops.gis_layers (
          id, organization_id, project_id, code, name,
          layer_type, source_type, source_file_id, source_url,
          crs_epsg, opacity, z_order, visible_by_default,
          min_zoom, max_zoom, style_config, status,
          created_by, created_at, updated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5,
          $6, $7, $8::uuid, $9,
          $10, $11, $12, $13,
          $14, $15, $16::jsonb, 'ready',
          $17::uuid, now(), now()
        ) RETURNING *`,
        [
          id,
          orgId,
          projectId,
          input.code,
          input.name,
          input.layerType,
          input.sourceType,
          input.sourceFileId ?? null,
          input.sourceUrl ?? null,
          input.crsEpsg ?? 3857,
          input.opacity ?? 1.0,
          input.zOrder ?? 0,
          input.visibleByDefault ?? true,
          input.minZoom ?? null,
          input.maxZoom ?? null,
          JSON.stringify(input.styleConfig ?? {}),
          identity.userId,
        ],
      );

      return rows[0]!;
    });
  }

  // 3. Drone Flights
  async createDroneFlight(
    identity: RequestIdentity,
    projectId: string,
    input: DroneFlightInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const flightId = randomUUID();

      const rows = await transaction.query<{
        id: string;
        code: string;
        name: string;
        flight_date: Date;
        status: string;
        created_at: Date;
      }>(
        `INSERT INTO vinops.drone_flights (
          id, organization_id, project_id, code, name,
          flight_date, pilot_name, drone_model, camera_model,
          gsd_cm, altitude_m, overlap_pct, sidelap_pct,
          area_covered_sqm, photo_count, raw_data_size_bytes,
          processing_software, crs_epsg, flight_boundary,
          status, notes, created_by, created_at, updated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19::jsonb,
          'uploaded', $20, $21::uuid, now(), now()
        ) RETURNING *`,
        [
          flightId,
          orgId,
          projectId,
          input.code,
          input.name,
          input.flightDate,
          input.pilotName,
          input.droneModel,
          input.cameraModel,
          input.gsdCm ?? null,
          input.altitudeM ?? null,
          input.overlapPct ?? null,
          input.sidelapPct ?? null,
          input.areaCoveredSqm ?? null,
          input.photoCount ?? null,
          input.rawDataSizeBytes ?? null,
          input.processingSoftware ?? 'WebODM',
          input.crsEpsg ?? 4326,
          JSON.stringify(input.flightBoundary),
          input.notes ?? '',
          identity.userId,
        ],
      );

      return rows[0]!;
    });
  }

  async listDroneFlights(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<{
        id: string;
        code: string;
        name: string;
        flight_date: Date;
        pilot_name: string;
        status: string;
        gsd_cm: string | null;
        created_at: Date;
      }>(
        `SELECT id, code, name, flight_date, pilot_name, status, gsd_cm, created_at
           FROM vinops.drone_flights
          WHERE project_id = $1::uuid
          ORDER BY flight_date DESC`,
        [projectId],
      );
      return rows as unknown as JsonRecord[];
    });
  }

  // 4. Drone Orthophotos
  async registerDroneOrthophoto(
    identity: RequestIdentity,
    projectId: string,
    flightId: string,
    input: DroneOrthophotoInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const orthoId = randomUUID();

      const rows = await transaction.query<{
        id: string;
        flight_id: string;
        source_file_id: string;
        processing_status: string;
      }>(
        `INSERT INTO vinops.drone_orthophotos (
          id, organization_id, project_id, flight_id,
          source_file_id, file_size_bytes, crs_epsg,
          bounds_geojson, resolution_m, band_count, bit_depth,
          processing_status, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5::uuid, $6, $7,
          $8::jsonb, $9, $10, $11,
          'pending', now()
        ) RETURNING id, flight_id, source_file_id, processing_status`,
        [
          orthoId,
          orgId,
          projectId,
          flightId,
          input.sourceFileId,
          input.fileSizeBytes,
          input.crsEpsg ?? 3857,
          JSON.stringify(input.boundsGeojson),
          input.resolutionM ?? 0.025,
          input.bandCount ?? 3,
          input.bitDepth ?? 8,
        ],
      );

      // Record outbox event for GDAL worker
      await transaction.query(
        `INSERT INTO vinops.outbox_events (
          id, organization_id, project_id,
          aggregate_type, aggregate_id, event_type,
          payload, status, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid,
          'drone_orthophoto', $4::uuid, 'drone_orthophoto.uploaded.v1',
          $5::jsonb, 'pending', now()
        )`,
        [
          randomUUID(),
          orgId,
          projectId,
          orthoId,
          JSON.stringify({
            ortho_id: orthoId,
            flight_id: flightId,
            project_id: projectId,
            organization_id: orgId,
            source_file_id: input.sourceFileId,
            actor_user_id: identity.userId,
            correlation_id: correlationId,
          }),
        ],
      );

      return {
        id: rows[0]!.id,
        flightId: rows[0]!.flight_id,
        sourceFileId: rows[0]!.source_file_id,
        processingStatus: rows[0]!.processing_status,
        message: 'Drone orthophoto queued for GDAL Cloud-Optimized GeoTIFF (COG) conversion',
      };
    });
  }

  // 5. Spatial Annotations
  async createSpatialAnnotation(
    identity: RequestIdentity,
    projectId: string,
    input: SpatialAnnotationInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const id = randomUUID();

      const rows = await transaction.query<{
        id: string;
        geometry_type: string;
        label: string;
        entity_type: string | null;
        entity_id: string | null;
        color: string;
        created_at: Date;
      }>(
        `INSERT INTO vinops.spatial_annotations (
          id, organization_id, project_id,
          geometry_type, geometry_geojson, properties,
          layer_id, entity_type, entity_id,
          label, color, created_by, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid,
          $4, $5::jsonb, $6::jsonb,
          $7::uuid, $8, $9::uuid,
          $10, $11, $12::uuid, now()
        ) RETURNING *`,
        [
          id,
          orgId,
          projectId,
          input.geometryType,
          JSON.stringify(input.geometryGeojson),
          JSON.stringify(input.properties ?? {}),
          input.layerId ?? null,
          input.entityType ?? null,
          input.entityId ?? null,
          input.label,
          input.color ?? '#FF0000',
          identity.userId,
        ],
      );

      return rows[0]!;
    });
  }

  async listSpatialAnnotations(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<{
        id: string;
        geometry_type: string;
        geometry_geojson: JsonRecord;
        properties: JsonRecord;
        entity_type: string | null;
        entity_id: string | null;
        label: string;
        color: string;
        created_at: Date;
      }>(`SELECT * FROM vinops.spatial_annotations WHERE project_id = $1::uuid`, [projectId]);
      return rows as unknown as JsonRecord[];
    });
  }

  // 6. Geodetic Survey Control Points
  async createSurveyControlPoint(
    identity: RequestIdentity,
    projectId: string,
    input: SurveyControlPointInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);
      const id = randomUUID();

      const rows = await transaction.query<{
        id: string;
        code: string;
        name: string;
        point_type: string;
        latitude: string;
        longitude: string;
        elevation_m: string;
        vn2000_x: string | null;
        vn2000_y: string | null;
        status: string;
        created_at: Date;
      }>(
        `INSERT INTO vinops.survey_control_points (
          id, organization_id, project_id, code, name,
          point_type, latitude, longitude, elevation_m,
          vn2000_x, vn2000_y, crs_epsg,
          accuracy_h_mm, accuracy_v_mm, survey_date,
          surveyor_name, instrument_type, status,
          created_by, created_at, updated_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12,
          $13, $14, $15,
          $16, $17, 'active',
          $18::uuid, now(), now()
        ) RETURNING *`,
        [
          id,
          orgId,
          projectId,
          input.code,
          input.name,
          input.pointType,
          input.latitude,
          input.longitude,
          input.elevationM,
          input.vn2000X ?? null,
          input.vn2000Y ?? null,
          input.crsEpsg ?? 4326,
          input.accuracyHMm ?? 5.0,
          input.accuracyVMm ?? 5.0,
          input.surveyDate ?? new Date().toISOString().split('T')[0],
          input.surveyorName,
          input.instrumentType ?? 'GNSS_RTK',
          identity.userId,
        ],
      );

      return rows[0]!;
    });
  }

  async listSurveyControlPoints(
    identity: RequestIdentity,
    projectId: string,
    correlationId: string,
  ): Promise<JsonRecord[]> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const rows = await transaction.query<{
        id: string;
        code: string;
        name: string;
        point_type: string;
        latitude: string;
        longitude: string;
        elevation_m: string;
        vn2000_x: string | null;
        vn2000_y: string | null;
        status: string;
      }>(
        `SELECT * FROM vinops.survey_control_points WHERE project_id = $1::uuid ORDER BY code ASC`,
        [projectId],
      );
      return rows as unknown as JsonRecord[];
    });
  }

  async updateSurveyControlPointStatus(
    identity: RequestIdentity,
    projectId: string,
    pointId: string,
    status: 'active' | 'superseded' | 'destroyed',
    notes: string | undefined,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (transaction) => {
      const orgId = await this.getProjectOrganizationId(transaction, projectId);

      const rows = await transaction.query<{ id: string; code: string; status: string }>(
        `UPDATE vinops.survey_control_points
            SET status = $1, updated_at = now()
          WHERE id = $2::uuid AND project_id = $3::uuid
        RETURNING id, code, status`,
        [status, pointId, projectId],
      );

      const updated = rows[0];
      if (!updated) {
        throw new PlatformError('SURVEY_POINT_NOT_FOUND', 'errors.not_found', 404);
      }

      // Record audit event
      await transaction.query(
        `INSERT INTO vinops.audit_events (
          id, organization_id, project_id, actor_user_id,
          action, entity_type, entity_id, details, created_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          'survey_point.status_updated', 'survey_control_point', $5::uuid,
          $6::jsonb, now()
        )`,
        [
          randomUUID(),
          orgId,
          projectId,
          identity.userId,
          pointId,
          JSON.stringify({ status, notes: notes ?? '' }),
        ],
      );

      return updated;
    });
  }

  private async getProjectOrganizationId(
    transaction: Transaction,
    projectId: string,
  ): Promise<string> {
    const rows = await transaction.query<{ organization_id: string }>(
      'SELECT organization_id FROM vinops.projects WHERE id = $1::uuid',
      [projectId],
    );
    const row = rows[0];
    if (!row) {
      throw new PlatformError('PROJECT_NOT_FOUND', 'errors.not_found', 404);
    }
    return row.organization_id;
  }

  private async transaction<T>(
    identity: RequestIdentity,
    correlationId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    if (!this.database) {
      throw new PlatformError('DATABASE_UNAVAILABLE', 'errors.internal', 503);
    }
    return this.database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      operation,
    );
  }
}
