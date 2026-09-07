export type GisProjectSettingsDto = {
  id: string;
  organizationId: string;
  projectId: string;
  defaultCrsEpsg: number;
  vn2000Zone: string | null;
  vn2000CentralMeridian: number | null;
  projectCenterLat: number | null;
  projectCenterLng: number | null;
  defaultZoomLevel: number;
  baseMapStyle: 'satellite' | 'streets' | 'topo' | 'dark' | 'hybrid';
  enableCadOverlay: boolean;
  enableDroneOverlay: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type UpdateGisProjectSettingsRequest = {
  defaultCrsEpsg?: number | undefined;
  vn2000Zone?: string | undefined;
  vn2000CentralMeridian?: number | undefined;
  projectCenterLat?: number | undefined;
  projectCenterLng?: number | undefined;
  defaultZoomLevel?: number | undefined;
  baseMapStyle?: 'satellite' | 'streets' | 'topo' | 'dark' | 'hybrid' | undefined;
  enableCadOverlay?: boolean | undefined;
  enableDroneOverlay?: boolean | undefined;
};

export type GisLayerType =
  | 'project_boundary'
  | 'site_plan'
  | 'cad_overlay'
  | 'orthophoto'
  | 'point_cloud'
  | 'survey_control'
  | 'utility_network'
  | 'earthwork_zone';

export type GisSourceType = 'geojson' | 'cog_geotiff' | 'vector_tile' | 'wms';

export type GisLayerDto = {
  id: string;
  organizationId: string;
  projectId: string;
  code: string;
  name: string;
  layerType: GisLayerType;
  sourceType: GisSourceType;
  sourceFileId?: string | null | undefined;
  sourceUrl?: string | null | undefined;
  crsEpsg: number;
  opacity: number;
  zOrder: number;
  visibleByDefault: boolean;
  minZoom?: number | null | undefined;
  maxZoom?: number | null | undefined;
  styleConfig: Record<string, unknown>;
  status: 'draft' | 'processing' | 'ready' | 'failed' | 'archived';
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateGisLayerRequest = {
  code: string;
  name: string;
  layerType: GisLayerType;
  sourceType: GisSourceType;
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

export type DroneFlightDto = {
  id: string;
  organizationId: string;
  projectId: string;
  code: string;
  name: string;
  flightDate: string;
  pilotName: string;
  droneModel: string;
  cameraModel: string;
  gsdCm?: number | null | undefined;
  altitudeM?: number | null | undefined;
  overlapPct?: number | null | undefined;
  sidelapPct?: number | null | undefined;
  areaCoveredSqm?: number | null | undefined;
  photoCount?: number | null | undefined;
  rawDataSizeBytes?: number | null | undefined;
  processingSoftware: string;
  crsEpsg: number;
  flightBoundary: Record<string, unknown>;
  status: 'planned' | 'uploaded' | 'processing' | 'ready' | 'failed';
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateDroneFlightRequest = {
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

export type DroneOrthophotoDto = {
  id: string;
  organizationId: string;
  projectId: string;
  flightId: string;
  sourceFileId: string;
  cogFileId?: string | null | undefined;
  fileSizeBytes: number;
  cogSizeBytes?: number | null | undefined;
  crsEpsg: number;
  boundsGeojson: Record<string, unknown>;
  resolutionM?: number | null | undefined;
  bandCount: number;
  bitDepth: number;
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed';
  processingError?: string | null | undefined;
  processingDurationMs?: number | null | undefined;
  createdAt: string;
};

export type CreateDroneOrthophotoRequest = {
  sourceFileId: string;
  fileSizeBytes: number;
  crsEpsg?: number | undefined;
  boundsGeojson: Record<string, unknown>;
  resolutionM?: number | undefined;
  bandCount?: number | undefined;
  bitDepth?: number | undefined;
};

export type SpatialAnnotationDto = {
  id: string;
  organizationId: string;
  projectId: string;
  geometryType: 'point' | 'linestring' | 'polygon' | 'circle';
  geometryGeojson: Record<string, unknown>;
  properties: Record<string, unknown>;
  layerId?: string | null | undefined;
  entityType?:
    'field_issue' | 'inspection' | 'survey_point' | 'measurement' | 'note' | null | undefined;
  entityId?: string | null | undefined;
  label: string;
  color: string;
  createdAt: string;
};

export type CreateSpatialAnnotationRequest = {
  geometryType: 'point' | 'linestring' | 'polygon' | 'circle';
  geometryGeojson: Record<string, unknown>;
  properties?: Record<string, unknown> | undefined;
  layerId?: string | undefined;
  entityType?: 'field_issue' | 'inspection' | 'survey_point' | 'measurement' | 'note' | undefined;
  entityId?: string | undefined;
  label: string;
  color?: string | undefined;
};

export type SurveyControlPointDto = {
  id: string;
  organizationId: string;
  projectId: string;
  code: string;
  name: string;
  pointType:
    'benchmark' | 'control_horizontal' | 'control_vertical' | 'boundary_marker' | 'reference_stake';
  latitude: number;
  longitude: number;
  elevationM: number;
  vn2000X?: number | null | undefined;
  vn2000Y?: number | null | undefined;
  crsEpsg: number;
  accuracyHMm: number;
  accuracyVMm: number;
  surveyDate: string;
  surveyorName: string;
  instrumentType: 'GNSS_RTK' | 'Total_Station' | 'Digital_Level' | 'Drone_GCP';
  status: 'active' | 'superseded' | 'destroyed';
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateSurveyControlPointRequest = {
  code: string;
  name: string;
  pointType:
    'benchmark' | 'control_horizontal' | 'control_vertical' | 'boundary_marker' | 'reference_stake';
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
  instrumentType?: 'GNSS_RTK' | 'Total_Station' | 'Digital_Level' | 'Drone_GCP' | undefined;
};

export type UpdateSurveyControlPointRequest = {
  status: 'active' | 'superseded' | 'destroyed';
  notes?: string | undefined;
};
