-- Migration: 019_gis_drone_orthophoto.sql
-- Description: GIS Project Settings, Layers, Drone Flights, Orthophotos (COG),
--              Spatial Annotations, and Geodetic Survey Control Points.
-- Schema: vinops
-- Standards: ADR-017, ISO 19115, OGC COG, VN-2000 (TT 25/2014/TT-BTNMT)

-- -----------------------------------------------------------------------------
-- 1. Table: vinops.gis_project_settings
-- Per-project GIS configuration (CRS, default center, base map style)
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.gis_project_settings (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  default_crs_epsg integer NOT NULL DEFAULT 4326 CHECK (default_crs_epsg IN (4326, 3857, 3405, 3406, 9208, 9209)),
  vn2000_zone text CHECK (vn2000_zone IN (
    'zone_3_hcm', 'zone_3_hanoi', 'zone_3_danang', 'zone_3_haiphong', 'zone_3_cantho',
    'zone_3_dongnai', 'zone_3_binhduong', 'zone_3_quangninh', 'zone_3_khanhhoa',
    'zone_6_48', 'zone_6_49'
  )),
  vn2000_central_meridian numeric(6, 2),
  project_center_lat numeric(10, 7) CHECK (project_center_lat BETWEEN -90.0 AND 90.0),
  project_center_lng numeric(10, 7) CHECK (project_center_lng BETWEEN -180.0 AND 180.0),
  default_zoom_level integer NOT NULL DEFAULT 15 CHECK (default_zoom_level BETWEEN 1 AND 24),
  base_map_style text NOT NULL DEFAULT 'satellite' CHECK (base_map_style IN ('satellite', 'streets', 'topo', 'dark', 'hybrid')),
  enable_cad_overlay boolean NOT NULL DEFAULT true,
  enable_drone_overlay boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id)
);

CREATE INDEX gis_project_settings_tenant_idx ON vinops.gis_project_settings (organization_id, project_id);

-- -----------------------------------------------------------------------------
-- 2. Table: vinops.gis_layers
-- Multi-purpose Map Layers (CAD, GeoJSON, COG Orthophoto, Vector Tiles)
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.gis_layers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  layer_type text NOT NULL CHECK (layer_type IN (
    'project_boundary', 'site_plan', 'cad_overlay', 'orthophoto',
    'point_cloud', 'survey_control', 'utility_network', 'earthwork_zone'
  )),
  source_type text NOT NULL CHECK (source_type IN ('geojson', 'cog_geotiff', 'vector_tile', 'wms')),
  source_file_id uuid REFERENCES vinops.file_objects(id),
  source_url text,
  crs_epsg integer NOT NULL DEFAULT 3857,
  opacity numeric(3, 2) NOT NULL DEFAULT 1.00 CHECK (opacity BETWEEN 0.00 AND 1.00),
  z_order integer NOT NULL DEFAULT 0 CHECK (z_order BETWEEN -100 AND 100),
  visible_by_default boolean NOT NULL DEFAULT true,
  min_zoom integer CHECK (min_zoom BETWEEN 0 AND 24),
  max_zoom integer CHECK (max_zoom BETWEEN 0 AND 24),
  style_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'processing', 'ready', 'failed', 'archived')),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 2 AND 80),
  CHECK (length(trim(name)) BETWEEN 2 AND 255)
);

CREATE INDEX gis_layers_project_idx ON vinops.gis_layers (project_id, status, z_order);
CREATE INDEX gis_layers_source_file_idx ON vinops.gis_layers (source_file_id) WHERE source_file_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 3. Table: vinops.drone_flights
-- UAV Survey Mission Records
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.drone_flights (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  flight_date date NOT NULL,
  pilot_name text NOT NULL,
  drone_model text NOT NULL,
  camera_model text NOT NULL,
  gsd_cm numeric(6, 2) CHECK (gsd_cm > 0),
  altitude_m numeric(8, 2) CHECK (altitude_m > 0),
  overlap_pct integer CHECK (overlap_pct BETWEEN 20 AND 95),
  sidelap_pct integer CHECK (sidelap_pct BETWEEN 20 AND 95),
  area_covered_sqm numeric(14, 2) CHECK (area_covered_sqm > 0),
  photo_count integer CHECK (photo_count > 0),
  raw_data_size_bytes bigint CHECK (raw_data_size_bytes > 0),
  processing_software text NOT NULL DEFAULT 'WebODM' CHECK (processing_software IN ('Pix4D', 'Agisoft Metashape', 'WebODM', 'DJI Terra', 'ContextCapture', 'Other')),
  crs_epsg integer NOT NULL DEFAULT 4326,
  flight_boundary jsonb NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'uploaded', 'processing', 'ready', 'failed')),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 2 AND 80),
  CHECK (length(trim(name)) BETWEEN 2 AND 255),
  CHECK (length(trim(pilot_name)) BETWEEN 2 AND 150),
  CHECK (length(trim(drone_model)) BETWEEN 2 AND 100),
  CHECK (length(trim(camera_model)) BETWEEN 2 AND 100)
);

CREATE INDEX drone_flights_project_date_idx ON vinops.drone_flights (project_id, flight_date DESC, status);

-- -----------------------------------------------------------------------------
-- 4. Table: vinops.drone_orthophotos
-- Processed Cloud-Optimized GeoTIFF (COG) records linked to UAV flights
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.drone_orthophotos (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  flight_id uuid NOT NULL REFERENCES vinops.drone_flights(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES vinops.file_objects(id),
  cog_file_id uuid REFERENCES vinops.file_objects(id),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  cog_size_bytes bigint CHECK (cog_size_bytes > 0),
  crs_epsg integer NOT NULL DEFAULT 3857,
  bounds_geojson jsonb NOT NULL,
  resolution_m numeric(8, 4) CHECK (resolution_m > 0),
  band_count integer NOT NULL DEFAULT 3 CHECK (band_count IN (1, 3, 4)),
  bit_depth integer NOT NULL DEFAULT 8 CHECK (bit_depth IN (8, 16, 32)),
  processing_status text NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  processing_error text,
  processing_duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);

CREATE INDEX drone_orthophotos_flight_idx ON vinops.drone_orthophotos (flight_id, processing_status);
CREATE INDEX drone_orthophotos_project_idx ON vinops.drone_orthophotos (project_id, created_at DESC);
CREATE INDEX drone_orthophotos_cog_file_idx ON vinops.drone_orthophotos (cog_file_id) WHERE cog_file_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 5. Table: vinops.spatial_annotations
-- Map annotations linked to field issues, inspections, or survey notes
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.spatial_annotations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  geometry_type text NOT NULL CHECK (geometry_type IN ('point', 'linestring', 'polygon', 'circle')),
  geometry_geojson jsonb NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  layer_id uuid REFERENCES vinops.gis_layers(id) ON DELETE SET NULL,
  entity_type text CHECK (entity_type IN ('field_issue', 'inspection', 'survey_point', 'measurement', 'note')),
  entity_id uuid,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#FF0000' CHECK (color ~ '^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$'),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(label)) BETWEEN 1 AND 255)
);

CREATE INDEX spatial_annotations_project_idx ON vinops.spatial_annotations (project_id, entity_type, entity_id);
CREATE INDEX spatial_annotations_layer_idx ON vinops.spatial_annotations (layer_id) WHERE layer_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 6. Table: vinops.survey_control_points
-- Geodetic Benchmark & Survey Stakes (Mốc khống chế trắc địa)
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.survey_control_points (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  point_type text NOT NULL CHECK (point_type IN ('benchmark', 'control_horizontal', 'control_vertical', 'boundary_marker', 'reference_stake')),
  latitude numeric(12, 9) NOT NULL CHECK (latitude BETWEEN -90.0 AND 90.0),
  longitude numeric(12, 9) NOT NULL CHECK (longitude BETWEEN -180.0 AND 180.0),
  elevation_m numeric(10, 4) NOT NULL,
  vn2000_x numeric(14, 4),
  vn2000_y numeric(14, 4),
  crs_epsg integer NOT NULL DEFAULT 4326,
  accuracy_h_mm numeric(8, 2) NOT NULL DEFAULT 5.0 CHECK (accuracy_h_mm >= 0),
  accuracy_v_mm numeric(8, 2) NOT NULL DEFAULT 5.0 CHECK (accuracy_v_mm >= 0),
  survey_date date NOT NULL DEFAULT CURRENT_DATE,
  surveyor_name text NOT NULL,
  instrument_type text NOT NULL DEFAULT 'GNSS_RTK' CHECK (instrument_type IN ('GNSS_RTK', 'Total_Station', 'Digital_Level', 'Drone_GCP')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'destroyed')),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 2 AND 80),
  CHECK (length(trim(name)) BETWEEN 2 AND 255),
  CHECK (length(trim(surveyor_name)) BETWEEN 2 AND 150)
);

CREATE INDEX survey_control_points_project_idx ON vinops.survey_control_points (project_id, status, point_type);

-- -----------------------------------------------------------------------------
-- Triggers: touch_updated_at, increment_version, prevent_delete
-- -----------------------------------------------------------------------------
-- gis_project_settings
CREATE TRIGGER gis_project_settings_touch BEFORE UPDATE ON vinops.gis_project_settings
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER gis_project_settings_version BEFORE UPDATE ON vinops.gis_project_settings
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER gis_project_settings_no_delete BEFORE DELETE ON vinops.gis_project_settings
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- gis_layers
CREATE TRIGGER gis_layers_touch BEFORE UPDATE ON vinops.gis_layers
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER gis_layers_version BEFORE UPDATE ON vinops.gis_layers
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER gis_layers_no_delete BEFORE DELETE ON vinops.gis_layers
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- drone_flights
CREATE TRIGGER drone_flights_touch BEFORE UPDATE ON vinops.drone_flights
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER drone_flights_version BEFORE UPDATE ON vinops.drone_flights
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER drone_flights_no_delete BEFORE DELETE ON vinops.drone_flights
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- drone_orthophotos (immutable processing record)
CREATE TRIGGER drone_orthophotos_no_delete BEFORE DELETE ON vinops.drone_orthophotos
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- spatial_annotations
CREATE TRIGGER spatial_annotations_no_delete BEFORE DELETE ON vinops.spatial_annotations
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- survey_control_points
CREATE TRIGGER survey_control_points_touch BEFORE UPDATE ON vinops.survey_control_points
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER survey_control_points_version BEFORE UPDATE ON vinops.survey_control_points
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER survey_control_points_no_delete BEFORE DELETE ON vinops.survey_control_points
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS) Policies
-- -----------------------------------------------------------------------------
ALTER TABLE vinops.gis_project_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.gis_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.drone_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.drone_orthophotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.spatial_annotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.survey_control_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY gis_project_settings_scoped ON vinops.gis_project_settings
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY gis_layers_scoped ON vinops.gis_layers
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY drone_flights_scoped ON vinops.drone_flights
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY drone_orthophotos_scoped ON vinops.drone_orthophotos
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY spatial_annotations_scoped ON vinops.spatial_annotations
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY survey_control_points_scoped ON vinops.survey_control_points
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

-- -----------------------------------------------------------------------------
-- Grant Runtime Privileges
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON
  vinops.gis_project_settings,
  vinops.gis_layers,
  vinops.drone_flights,
  vinops.drone_orthophotos,
  vinops.spatial_annotations,
  vinops.survey_control_points
TO vinops_app;

GRANT SELECT, INSERT, UPDATE ON
  vinops.gis_project_settings,
  vinops.gis_layers,
  vinops.drone_flights,
  vinops.drone_orthophotos,
  vinops.spatial_annotations,
  vinops.survey_control_points
TO vinops_worker;
