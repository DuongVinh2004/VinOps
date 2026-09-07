import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { VinopsDatabase, type Transaction } from '@vinops/database';
import { validateBcfViewpoint, type BimDiscipline, type BimEntityType } from '@vinops/domain';
import { API_CONFIG, type ApiRuntimeConfig } from '../api-runtime.js';
import { PlatformError } from '../platform-error.js';
import type { RequestIdentity } from '../platform.service.js';

type JsonRecord = Record<string, unknown>;

export interface UploadedFileInput {
  filename: string;
  size: number;
  buffer?: Buffer | undefined;
  sha256?: string | undefined;
}

export interface CreateBimModelInput {
  code: string;
  name: string;
  discipline: BimDiscipline;
  crsEpsg?: number;
  projectOriginX?: number;
  projectOriginY?: number;
  projectOriginZ?: number;
  rotationZ?: number;
  file?: unknown;
}

export interface CreateBimViewpointInput {
  modelId: string;
  title: string;
  cameraData: Record<string, unknown>;
  clippingPlanes?: unknown[];
  highlightedGuids?: string[];
  hiddenGuids?: string[];
  snapshotFileId?: string;
  fieldIssueId?: string;
}

interface BimModelListRow {
  id: string;
  code: string;
  name: string;
  discipline: string;
  status: string;
  revision_number: number | null;
  elements_count: number | null;
  file_size_bytes: number;
  gltf_size_bytes: number | null;
  conversion_duration_ms: number | null;
  updated_at: string;
}

interface BimModelDetailRow {
  id: string;
  project_id: string;
  code: string;
  name: string;
  discipline: string;
  status: string;
  crs_epsg: number | null;
  project_origin_x: number | string;
  project_origin_y: number | string;
  project_origin_z: number | string;
  rotation_z: number | string;
  current_revision_id: string | null;
  created_at: string;
  updated_at: string;
  revision_id: string | null;
  revision_number: number | null;
  raw_ifc_file_id: string | null;
  converted_gltf_file_id: string | null;
  file_size_bytes: number | string;
  gltf_size_bytes: number | string | null;
  elements_count: number | null;
  conversion_status: string | null;
  bounding_box: unknown;
}

interface BimElementRow {
  id: string;
  ifc_guid: string;
  ifc_type: string;
  name: string;
  storey_name: string | null;
  properties: unknown;
  bounding_box: unknown;
  location_node_id: string | null;
  location_name: string | null;
}

interface BimElementLinkRow {
  id: string;
  entity_type: string;
  entity_id: string;
  linked_at: string;
  issue_code: string | null;
  issue_title: string | null;
  issue_status: string | null;
  issue_severity: string | null;
  rfi_code: string | null;
  rfi_title: string | null;
  rfi_status: string | null;
  insp_code: string | null;
  insp_title: string | null;
  insp_status: string | null;
}

interface BimViewpointRow {
  id: string;
  bim_model_id: string;
  title: string;
  snapshot_file_id: string | null;
  highlighted_guids: string[] | null;
  hidden_guids: string[] | null;
  created_by_name: string;
  created_at: string;
  camera_data?: Record<string, unknown>;
  clipping_planes?: unknown[];
  field_issue_id?: string | null;
}

@Injectable()
export class BimService implements OnModuleDestroy {
  private readonly database: VinopsDatabase | undefined;

  constructor(@Inject(API_CONFIG) private readonly config: ApiRuntimeConfig) {
    this.database =
      config.VINOPS_DATABASE_URL === undefined
        ? undefined
        : new VinopsDatabase({
            connectionString: config.VINOPS_DATABASE_URL,
            applicationName: 'vinops-bim-api',
            runtimeRole: 'vinops_app',
          });
  }

  async onModuleDestroy(): Promise<void> {
    await this.database?.close();
  }

  private async transaction<T>(
    identity: RequestIdentity,
    correlationId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    if (this.database === undefined) {
      throw new PlatformError('DEPENDENCY_UNAVAILABLE', 'errors.dependencyUnavailable', 503, true);
    }
    return this.database.withTransaction(
      { actorUserId: identity.userId, correlationId },
      operation,
    );
  }

  private async getProjectOrganizationId(
    transaction: Transaction,
    projectId: string,
  ): Promise<string> {
    const rows = await transaction.query<{ organization_id: string }>(
      `SELECT organization_id FROM vinops.projects WHERE id = $1::uuid`,
      [projectId],
    );
    const orgId = rows[0]?.organization_id;
    if (!orgId) {
      throw new PlatformError('RESOURCE_NOT_FOUND', 'errors.projectNotFound', 404, false);
    }
    return orgId;
  }

  async createModel(
    identity: RequestIdentity,
    projectId: string,
    input: CreateBimModelInput,
    file: UploadedFileInput | undefined,
    correlationId: string,
  ): Promise<JsonRecord> {
    if (!input.code || input.code.trim().length === 0) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }
    if (!input.name || input.name.trim().length === 0) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }

    return this.transaction(identity, correlationId, async (tx) => {
      const orgId = await this.getProjectOrganizationId(tx, projectId);
      const modelId = randomUUID();
      const revisionId = randomUUID();
      const rawFileId = randomUUID();

      const filename = file?.filename ?? `${input.code}.ifc`;
      const fileSizeBytes = file?.size ?? 1024;
      const sha256 =
        file?.sha256 ??
        (file?.buffer
          ? createHash('sha256').update(file.buffer).digest('hex')
          : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

      // 1. Create file_object record for raw IFC
      const quarantineKey = `quarantine/${projectId}/${rawFileId}/${filename}`;
      const availableKey = `available/${projectId}/${rawFileId}/${filename}`;
      await tx.execute(
        `INSERT INTO vinops.file_objects (
          id, organization_id, project_id, storage_provider, storage_bucket,
          quarantine_object_key, available_object_key, original_filename,
          declared_size_bytes, actual_size_bytes, declared_media_type,
          declared_sha256, actual_sha256, status, created_by, available_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 's3', $4,
          $5, $6, $7,
          $8, $8, 'application/x-step',
          $9, $9, 'Available', $10::uuid, now()
        )`,
        [
          rawFileId,
          orgId,
          projectId,
          this.config.VINOPS_S3_BUCKET ?? 'vinops-files',
          quarantineKey,
          availableKey,
          filename,
          fileSizeBytes,
          sha256,
          identity.userId,
        ],
      );

      // 2. Insert bim_models
      await tx.execute(
        `INSERT INTO vinops.bim_models (
          id, organization_id, project_id, code, name, discipline,
          status, crs_epsg, project_origin_x, project_origin_y, project_origin_z,
          rotation_z, current_revision_id, created_by
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
          'processing', $7, $8, $9, $10,
          $11, NULL, $12::uuid
        )`,
        [
          modelId,
          orgId,
          projectId,
          input.code.trim(),
          input.name.trim(),
          input.discipline,
          input.crsEpsg ?? 3857,
          input.projectOriginX ?? 0,
          input.projectOriginY ?? 0,
          input.projectOriginZ ?? 0,
          input.rotationZ ?? 0,
          identity.userId,
        ],
      );

      // 3. Insert bim_model_revisions
      await tx.execute(
        `INSERT INTO vinops.bim_model_revisions (
          id, organization_id, project_id, bim_model_id, revision_number,
          raw_ifc_file_id, file_size_bytes, conversion_status, created_by
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1,
          $5::uuid, $6, 'pending', $7::uuid
        )`,
        [revisionId, orgId, projectId, modelId, rawFileId, fileSizeBytes, identity.userId],
      );

      // 4. Update current_revision_id on model
      await tx.execute(
        `UPDATE vinops.bim_models SET current_revision_id = $1::uuid WHERE id = $2::uuid`,
        [revisionId, modelId],
      );

      // 5. Emit Outbox Event
      await tx.execute(
        `INSERT INTO vinops.outbox_events (
          id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, 'bim_model', $4::uuid, 'bim_model.uploaded.v1', $5::jsonb
        )`,
        [
          randomUUID(),
          orgId,
          projectId,
          modelId,
          JSON.stringify({
            modelId,
            revisionId,
            sourceFileId: rawFileId,
            code: input.code,
            discipline: input.discipline,
            correlationId,
          }),
        ],
      );

      return {
        modelId,
        projectId,
        code: input.code,
        name: input.name,
        discipline: input.discipline,
        status: 'processing',
        revision: {
          revisionId,
          revisionNumber: 1,
          rawIfcFileId: rawFileId,
          fileSizeBytes,
          conversionStatus: 'pending',
          createdAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      };
    });
  }

  async listModels(
    identity: RequestIdentity,
    projectId: string,
    filter: { status?: string | undefined; discipline?: string | undefined },
    correlationId: string,
  ): Promise<JsonRecord[]> {
    return this.transaction(identity, correlationId, async (tx) => {
      let query = `
        SELECT m.id, m.project_id, m.code, m.name, m.discipline, m.status,
               m.crs_epsg, m.project_origin_x, m.project_origin_y, m.project_origin_z, m.rotation_z,
               m.current_revision_id, m.created_at, m.updated_at,
               r.revision_number, r.elements_count, r.file_size_bytes, r.gltf_size_bytes,
               r.conversion_duration_ms, r.conversion_status
        FROM vinops.bim_models m
        LEFT JOIN vinops.bim_model_revisions r ON r.id = m.current_revision_id
        WHERE m.project_id = $1::uuid AND m.archived_at IS NULL
      `;
      const params: unknown[] = [projectId];

      if (filter.status) {
        params.push(filter.status);
        query += ` AND m.status = $${params.length}`;
      }
      if (filter.discipline) {
        params.push(filter.discipline);
        query += ` AND m.discipline = $${params.length}`;
      }

      query += ` ORDER BY m.created_at DESC`;

      const rows = await tx.query<BimModelListRow>(query, params);
      return rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        discipline: r.discipline,
        status: r.status,
        currentRevision: r.revision_number
          ? {
              revisionNumber: r.revision_number,
              elementsCount: r.elements_count ?? 0,
              rawFileSizeMb: Number((r.file_size_bytes / (1024 * 1024)).toFixed(2)),
              gltfFileSizeMb: r.gltf_size_bytes
                ? Number((r.gltf_size_bytes / (1024 * 1024)).toFixed(2))
                : 0,
              conversionDurationSec: r.conversion_duration_ms
                ? Math.round(r.conversion_duration_ms / 1000)
                : 0,
            }
          : null,
        updatedAt: r.updated_at,
      }));
    });
  }

  async getModel(
    identity: RequestIdentity,
    projectId: string,
    modelId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (tx) => {
      const rows = await tx.query<BimModelDetailRow>(
        `SELECT m.id, m.project_id, m.code, m.name, m.discipline, m.status,
                m.crs_epsg, m.project_origin_x, m.project_origin_y, m.project_origin_z, m.rotation_z,
                m.current_revision_id, m.created_at, m.updated_at,
                r.id as revision_id, r.revision_number, r.raw_ifc_file_id, r.converted_gltf_file_id,
                r.file_size_bytes, r.gltf_size_bytes, r.elements_count, r.conversion_status, r.bounding_box
         FROM vinops.bim_models m
         LEFT JOIN vinops.bim_model_revisions r ON r.id = m.current_revision_id
         WHERE m.id = $1::uuid AND m.project_id = $2::uuid AND m.archived_at IS NULL`,
        [modelId, projectId],
      );
      const row = rows[0];
      if (!row) {
        throw new PlatformError('RESOURCE_NOT_FOUND', 'errors.modelNotFound', 404, false);
      }

      return {
        modelId: row.id,
        projectId: row.project_id,
        code: row.code,
        name: row.name,
        discipline: row.discipline,
        status: row.status,
        crsEpsg: row.crs_epsg,
        projectOrigin: {
          x: Number(row.project_origin_x),
          y: Number(row.project_origin_y),
          z: Number(row.project_origin_z),
        },
        rotationZ: Number(row.rotation_z),
        currentRevision: row.revision_id
          ? {
              revisionId: row.revision_id,
              revisionNumber: row.revision_number,
              rawIfcFileId: row.raw_ifc_file_id,
              convertedGltfFileId: row.converted_gltf_file_id,
              fileSizeBytes: Number(row.file_size_bytes),
              gltfSizeBytes: row.gltf_size_bytes ? Number(row.gltf_size_bytes) : null,
              elementsCount: row.elements_count ?? 0,
              conversionStatus: row.conversion_status,
              boundingBox: row.bounding_box,
            }
          : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  async getManifest(
    identity: RequestIdentity,
    projectId: string,
    modelId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    const model = await this.getModel(identity, projectId, modelId, correlationId);
    const revision = (model['currentRevision'] ?? {}) as Record<string, unknown>;

    const s3Endpoint = this.config.VINOPS_S3_ENDPOINT ?? 'http://localhost:9000';
    const bucket = this.config.VINOPS_S3_BUCKET ?? 'vinops-files';

    return {
      modelId,
      revisionNumber: revision['revisionNumber'] ?? 1,
      gltfDownloadUrl: `${s3Endpoint}/${bucket}/bim/${modelId}/model.glb`,
      spatialTreeUrl: `${s3Endpoint}/${bucket}/bim/${modelId}/spatial_tree.json`,
      boundingBox: revision['boundingBox'] ?? {
        min: [-10.0, 0.0, -10.0],
        max: [10.0, 10.0, 10.0],
        center: [0.0, 5.0, 0.0],
      },
      projectOrigin: model['projectOrigin'],
      dracoCompression: {
        enabled: true,
        decoderPath: '/static/wasm/draco/',
      },
    };
  }

  async getElementByGuid(
    identity: RequestIdentity,
    projectId: string,
    ifcGuid: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (tx) => {
      const rows = await tx.query<BimElementRow>(
        `SELECT e.id, e.ifc_guid, e.ifc_type, e.name, e.storey_name,
                e.properties, e.bounding_box, e.location_node_id,
                l.name as location_name
         FROM vinops.bim_elements e
         LEFT JOIN vinops.location_nodes l ON l.id = e.location_node_id
         WHERE e.project_id = $1::uuid AND e.ifc_guid = $2
         LIMIT 1`,
        [projectId, ifcGuid],
      );
      const row = rows[0];
      if (!row) {
        throw new PlatformError('RESOURCE_NOT_FOUND', 'errors.elementNotFound', 404, false);
      }

      return {
        id: row.id,
        ifcGuid: row.ifc_guid,
        ifcType: row.ifc_type,
        name: row.name,
        storeyName: row.storey_name,
        locationNodeId: row.location_node_id,
        locationPath: row.location_name ?? null,
        properties: row.properties,
        boundingBox: row.bounding_box,
      };
    });
  }

  async getElementLinks(
    identity: RequestIdentity,
    projectId: string,
    ifcGuid: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (tx) => {
      const rows = await tx.query<BimElementLinkRow>(
        `SELECT l.id, l.entity_type, l.entity_id, l.linked_at,
                i.code as issue_code, i.title as issue_title, i.severity as issue_severity, i.status as issue_status,
                r.code as rfi_code, r.title as rfi_title, r.status as rfi_status,
                insp.code as insp_code, insp.title as insp_title, insp.status as insp_status
         FROM vinops.bim_element_links l
         LEFT JOIN vinops.field_issues i ON l.entity_type = 'field_issue' AND i.id = l.entity_id
         LEFT JOIN vinops.rfi_requests r ON l.entity_type = 'rfi_request' AND r.id = l.entity_id
         LEFT JOIN vinops.inspections insp ON l.entity_type = 'inspection' AND insp.id = l.entity_id
         WHERE l.project_id = $1::uuid AND l.ifc_guid = $2
         ORDER BY l.linked_at DESC`,
        [projectId, ifcGuid],
      );

      const links = rows.map((r) => {
        const code = r.issue_code || r.rfi_code || r.insp_code;
        const title = r.issue_title || r.rfi_title || r.insp_title;
        const status = r.issue_status || r.rfi_status || r.insp_status;
        return {
          id: r.id,
          entityType: r.entity_type,
          entityId: r.entity_id,
          entityCode: code ?? undefined,
          entityTitle: title ?? undefined,
          severity: r.issue_severity ?? undefined,
          status: status ?? undefined,
          linkedAt: r.linked_at,
        };
      });

      return {
        ifcGuid,
        links,
      };
    });
  }

  async createElementLink(
    identity: RequestIdentity,
    projectId: string,
    ifcGuid: string,
    input: { modelId: string; entityType: BimEntityType; entityId: string },
    correlationId: string,
  ): Promise<JsonRecord> {
    if (!input.modelId || !input.entityType || !input.entityId) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }

    return this.transaction(identity, correlationId, async (tx) => {
      const orgId = await this.getProjectOrganizationId(tx, projectId);
      const linkId = randomUUID();

      await tx.execute(
        `INSERT INTO vinops.bim_element_links (
          id, organization_id, project_id, bim_model_id,
          ifc_guid, entity_type, entity_id, linked_by, linked_at
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid,
          $5, $6, $7::uuid, $8::uuid, now()
        )
        ON CONFLICT (bim_model_id, ifc_guid, entity_type, entity_id)
        DO UPDATE SET linked_at = now()`,
        [
          linkId,
          orgId,
          projectId,
          input.modelId,
          ifcGuid,
          input.entityType,
          input.entityId,
          identity.userId,
        ],
      );

      return {
        linkId,
        modelId: input.modelId,
        ifcGuid,
        entityType: input.entityType,
        entityId: input.entityId,
        linkedAt: new Date().toISOString(),
      };
    });
  }

  async saveViewpoint(
    identity: RequestIdentity,
    projectId: string,
    input: CreateBimViewpointInput,
    correlationId: string,
  ): Promise<JsonRecord> {
    if (!input.modelId || !input.title) {
      throw new PlatformError('VALIDATION_FAILED', 'errors.validation', 422, false);
    }

    // Validate camera & viewpoints
    validateBcfViewpoint({
      camera: input.cameraData,
      clippingPlanes: input.clippingPlanes ?? [],
      highlightedGuids: input.highlightedGuids ?? [],
      hiddenGuids: input.hiddenGuids ?? [],
    });

    return this.transaction(identity, correlationId, async (tx) => {
      const orgId = await this.getProjectOrganizationId(tx, projectId);
      const viewpointId = randomUUID();

      await tx.execute(
        `INSERT INTO vinops.bim_viewpoints (
          id, organization_id, project_id, bim_model_id, title,
          camera_data, clipping_planes, highlighted_guids, hidden_guids,
          snapshot_file_id, field_issue_id, created_by
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
          $6::jsonb, $7::jsonb, $8, $9,
          $10::uuid, $11::uuid, $12::uuid
        )`,
        [
          viewpointId,
          orgId,
          projectId,
          input.modelId,
          input.title.trim(),
          JSON.stringify(input.cameraData),
          JSON.stringify(input.clippingPlanes ?? []),
          input.highlightedGuids ?? [],
          input.hiddenGuids ?? [],
          input.snapshotFileId ?? null,
          input.fieldIssueId ?? null,
          identity.userId,
        ],
      );

      // Auto-link: If fieldIssueId is provided, link highlightedGuids to field_issue
      if (input.fieldIssueId && input.highlightedGuids && input.highlightedGuids.length > 0) {
        for (const guid of input.highlightedGuids) {
          await tx.execute(
            `INSERT INTO vinops.bim_element_links (
              id, organization_id, project_id, bim_model_id,
              ifc_guid, entity_type, entity_id, linked_by
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, $4::uuid,
              $5, 'field_issue', $6::uuid, $7::uuid
            )
            ON CONFLICT (bim_model_id, ifc_guid, entity_type, entity_id) DO NOTHING`,
            [
              randomUUID(),
              orgId,
              projectId,
              input.modelId,
              guid,
              input.fieldIssueId,
              identity.userId,
            ],
          );
        }
      }

      return {
        viewpointId,
        modelId: input.modelId,
        title: input.title,
        snapshotFileId: input.snapshotFileId ?? null,
        createdAt: new Date().toISOString(),
      };
    });
  }

  async listViewpoints(
    identity: RequestIdentity,
    projectId: string,
    modelId: string | undefined,
    correlationId: string,
  ): Promise<JsonRecord[]> {
    return this.transaction(identity, correlationId, async (tx) => {
      let query = `
        SELECT v.id, v.bim_model_id, v.title, v.snapshot_file_id,
               v.highlighted_guids, v.hidden_guids, v.created_at,
               u.display_name as created_by_name
        FROM vinops.bim_viewpoints v
        JOIN vinops.users u ON u.id = v.created_by
        WHERE v.project_id = $1::uuid AND v.archived_at IS NULL
      `;
      const params: unknown[] = [projectId];

      if (modelId) {
        params.push(modelId);
        query += ` AND v.bim_model_id = $${params.length}`;
      }

      query += ` ORDER BY v.created_at DESC`;

      const rows = await tx.query<BimViewpointRow>(query, params);
      return rows.map((r) => ({
        id: r.id,
        modelId: r.bim_model_id,
        title: r.title,
        snapshotFileId: r.snapshot_file_id,
        highlightedCount: Array.isArray(r.highlighted_guids) ? r.highlighted_guids.length : 0,
        hiddenCount: Array.isArray(r.hidden_guids) ? r.hidden_guids.length : 0,
        createdBy: r.created_by_name,
        createdAt: r.created_at,
      }));
    });
  }

  async getViewpoint(
    identity: RequestIdentity,
    projectId: string,
    viewpointId: string,
    correlationId: string,
  ): Promise<JsonRecord> {
    return this.transaction(identity, correlationId, async (tx) => {
      const rows = await tx.query<BimViewpointRow>(
        `SELECT v.id, v.bim_model_id, v.title, v.camera_data, v.clipping_planes,
                v.highlighted_guids, v.hidden_guids, v.snapshot_file_id,
                v.field_issue_id, v.created_at,
                u.display_name as created_by_name
         FROM vinops.bim_viewpoints v
         JOIN vinops.users u ON u.id = v.created_by
         WHERE v.id = $1::uuid AND v.project_id = $2::uuid AND v.archived_at IS NULL`,
        [viewpointId, projectId],
      );
      const row = rows[0];
      if (!row) {
        throw new PlatformError('RESOURCE_NOT_FOUND', 'errors.viewpointNotFound', 404, false);
      }

      return {
        id: row.id,
        modelId: row.bim_model_id,
        title: row.title,
        cameraData: row.camera_data,
        clippingPlanes: row.clipping_planes,
        highlightedGuids: row.highlighted_guids,
        hiddenGuids: row.hidden_guids,
        snapshotFileId: row.snapshot_file_id,
        fieldIssueId: row.field_issue_id,
        createdBy: row.created_by_name,
        createdAt: row.created_at,
      };
    });
  }
}
