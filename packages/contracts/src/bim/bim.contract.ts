/**
 * ADR-013: 3D Spatial Model / openBIM IFC & WebGL API Contracts
 */

export type BimDiscipline =
  | 'architectural'
  | 'structural'
  | 'mep'
  | 'infrastructure'
  | 'landscape'
  | 'coordination'
  | 'as_built';

export type BimModelStatus =
  | 'draft'
  | 'uploaded'
  | 'processing'
  | 'reprocessing'
  | 'ready'
  | 'failed'
  | 'archived'
  | 'active'
  | 'superseded';

export type BimConversionStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type BimEntityType =
  'field_issue' | 'rfi_request' | 'inspection' | 'acceptance_record' | 'location_node';

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

export interface BimModelRevisionResponse {
  revisionId: string;
  revisionNumber: number;
  rawIfcFileId: string;
  convertedGltfFileId?: string | null;
  spatialTreeFileId?: string | null;
  fileSizeBytes: number;
  gltfSizeBytes?: number | null;
  elementsCount: number;
  conversionStatus: BimConversionStatus;
  conversionError?: string | null;
  conversionDurationMs?: number | null;
  boundingBox?: Record<string, unknown>;
  createdAt: string;
}

export interface BimModelResponse {
  modelId: string;
  projectId: string;
  code: string;
  name: string;
  discipline: BimDiscipline;
  status: BimModelStatus;
  crsEpsg: number;
  projectOrigin: { x: number; y: number; z: number };
  rotationZ: number;
  currentRevision?: BimModelRevisionResponse | null;
  createdAt: string;
  updatedAt: string;
}

export interface BimModelListResponse {
  items: BimModelResponse[];
  total: number;
}

export interface BimManifestResponse {
  modelId: string;
  revisionNumber: number;
  gltfDownloadUrl: string;
  spatialTreeUrl: string;
  boundingBox: {
    min: [number, number, number];
    max: [number, number, number];
    center: [number, number, number];
  };
  projectOrigin: { x: number; y: number; z: number };
  dracoCompression: {
    enabled: boolean;
    decoderPath: string;
  };
}

export interface BimElementResponse {
  id: string;
  ifcGuid: string;
  ifcType: string;
  name: string;
  storeyName: string;
  locationNodeId?: string | null;
  locationPath?: string | null;
  properties: Record<string, Record<string, string | number | boolean>>;
  boundingBox?: Record<string, unknown>;
}

export interface BimElementLinkRequest {
  modelId: string;
  entityType: BimEntityType;
  entityId: string;
}

export interface BimElementLinkItem {
  id: string;
  entityType: BimEntityType;
  entityId: string;
  entityCode?: string;
  entityTitle?: string;
  severity?: string;
  status?: string;
  linkedAt: string;
}

export interface BimElementLinkResponse {
  linkId: string;
  modelId: string;
  ifcGuid: string;
  entityType: BimEntityType;
  entityId: string;
  linkedAt: string;
}

export interface BimElementLinksListResponse {
  ifcGuid: string;
  links: BimElementLinkItem[];
}

export interface CreateBimViewpointInput {
  modelId: string;
  title: string;
  cameraData: {
    type?: 'perspective' | 'orthographic';
    projection?: 'perspective' | 'orthographic';
    position?: { x: number; y: number; z: number };
    target?: { x: number; y: number; z: number };
    up?: { x: number; y: number; z: number };
    cameraViewPoint?: { x: number; y: number; z: number };
    cameraDirection?: { x: number; y: number; z: number };
    cameraUpVector?: { x: number; y: number; z: number };
    fieldOfView?: number;
  };
  clippingPlanes?: Array<{
    normal?: { x: number; y: number; z: number };
    distance?: number;
    location?: { x: number; y: number; z: number };
    direction?: { x: number; y: number; z: number };
  }>;
  highlightedGuids?: string[];
  hiddenGuids?: string[];
  snapshotFileId?: string | null;
  fieldIssueId?: string | null;
}

export interface BimViewpointResponse {
  viewpointId: string;
  modelId: string;
  title: string;
  cameraData: Record<string, unknown>;
  clippingPlanes: unknown[];
  highlightedGuids: string[];
  hiddenGuids: string[];
  snapshotFileId?: string | null;
  snapshotUrl?: string | null;
  fieldIssueId?: string | null;
  createdBy?: string;
  createdAt: string;
}

export interface BimViewpointListResponse {
  items: BimViewpointResponse[];
  total: number;
}
