-- Migration: 015_bim_space_model_and_spatial_linking.sql
-- Description: BIM 3D openBIM IFC Models, glTF Revisions, Elements, Spatial Links, and BCF Viewpoints / Topics

-- 1. Table: vinops.bim_models (Model Registry)
CREATE TABLE vinops.bim_models (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  discipline text NOT NULL CHECK (discipline IN ('architectural', 'structural', 'mep', 'infrastructure', 'landscape', 'coordination', 'as_built')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'uploaded', 'processing', 'reprocessing', 'ready', 'failed', 'archived', 'active', 'superseded')),
  crs_epsg integer DEFAULT 3857,
  project_origin_x numeric(16, 6) DEFAULT 0.000000,
  project_origin_y numeric(16, 6) DEFAULT 0.000000,
  project_origin_z numeric(16, 6) DEFAULT 0.000000,
  rotation_z numeric(8, 4) DEFAULT 0.0000,
  current_revision_id uuid,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 1 AND 100),
  CHECK (length(trim(name)) BETWEEN 1 AND 255)
);

CREATE INDEX bim_models_project_status_idx ON vinops.bim_models (project_id, status);
CREATE INDEX bim_models_discipline_idx ON vinops.bim_models (project_id, discipline);

-- 2. Table: vinops.bim_model_revisions (Version Tracking & Conversion Lifecycle)
CREATE TABLE vinops.bim_model_revisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  bim_model_id uuid NOT NULL REFERENCES vinops.bim_models(id) ON DELETE CASCADE,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  raw_ifc_file_id uuid NOT NULL REFERENCES vinops.file_objects(id),
  converted_gltf_file_id uuid REFERENCES vinops.file_objects(id),
  spatial_tree_file_id uuid REFERENCES vinops.file_objects(id),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  gltf_size_bytes bigint CHECK (gltf_size_bytes > 0),
  elements_count integer DEFAULT 0 CHECK (elements_count >= 0),
  conversion_status text NOT NULL DEFAULT 'pending' CHECK (conversion_status IN ('pending', 'processing', 'completed', 'failed')),
  conversion_error text,
  conversion_duration_ms integer CHECK (conversion_duration_ms >= 0),
  bounding_box jsonb DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (bim_model_id, revision_number)
);

CREATE INDEX bim_revisions_model_idx ON vinops.bim_model_revisions (bim_model_id, revision_number DESC);
CREATE INDEX bim_revisions_status_idx ON vinops.bim_model_revisions (conversion_status);

-- Circular FK for current_revision_id on vinops.bim_models
ALTER TABLE vinops.bim_models
  ADD CONSTRAINT fk_bim_models_current_revision
  FOREIGN KEY (current_revision_id) REFERENCES vinops.bim_model_revisions(id)
  DEFERRABLE INITIALLY DEFERRED;

-- 3. Table: vinops.bim_elements (Extracted IFC Elements Metadata & Spatial Placement)
CREATE TABLE vinops.bim_elements (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  bim_model_revision_id uuid NOT NULL REFERENCES vinops.bim_model_revisions(id) ON DELETE CASCADE,
  ifc_guid varchar(22) NOT NULL,
  ifc_type text NOT NULL,
  name text NOT NULL DEFAULT '',
  storey_name text NOT NULL DEFAULT '',
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  bounding_box jsonb NOT NULL DEFAULT '{}'::jsonb,
  location_node_id uuid REFERENCES vinops.location_nodes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (bim_model_revision_id, ifc_guid),
  CHECK (length(ifc_guid) = 22),
  CHECK (length(trim(ifc_type)) BETWEEN 1 AND 100)
);

CREATE INDEX bim_elements_revision_guid_idx ON vinops.bim_elements (bim_model_revision_id, ifc_guid);
CREATE INDEX bim_elements_ifc_type_idx ON vinops.bim_elements (bim_model_revision_id, ifc_type);
CREATE INDEX bim_elements_location_idx ON vinops.bim_elements (project_id, location_node_id) WHERE location_node_id IS NOT NULL;
CREATE INDEX bim_elements_properties_gin_idx ON vinops.bim_elements USING gin (properties);

-- 4. Table: vinops.bim_element_links (Cross-reference linking between BIM components and VinOps records)
CREATE TABLE vinops.bim_element_links (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  bim_model_id uuid NOT NULL REFERENCES vinops.bim_models(id) ON DELETE CASCADE,
  ifc_guid varchar(22) NOT NULL,
  entity_type text NOT NULL CHECK (entity_type IN ('field_issue', 'rfi_request', 'inspection', 'acceptance_record', 'location_node')),
  entity_id uuid NOT NULL,
  linked_by uuid NOT NULL REFERENCES vinops.users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (bim_model_id, ifc_guid, entity_type, entity_id),
  CHECK (length(ifc_guid) = 22)
);

CREATE INDEX bim_element_links_model_guid_idx ON vinops.bim_element_links (bim_model_id, ifc_guid);
CREATE INDEX bim_element_links_entity_idx ON vinops.bim_element_links (project_id, entity_type, entity_id);

-- 5. Table: vinops.bim_viewpoints (BCF 2.1/3.0 Camera Perspectives, Clipping Planes & Highlight States)
CREATE TABLE vinops.bim_viewpoints (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  bim_model_id uuid NOT NULL REFERENCES vinops.bim_models(id) ON DELETE CASCADE,
  title text NOT NULL,
  camera_data jsonb NOT NULL,
  clipping_planes jsonb NOT NULL DEFAULT '[]'::jsonb,
  highlighted_guids varchar(22)[] NOT NULL DEFAULT ARRAY[]::varchar(22)[],
  hidden_guids varchar(22)[] NOT NULL DEFAULT ARRAY[]::varchar(22)[],
  snapshot_file_id uuid REFERENCES vinops.file_objects(id),
  field_issue_id uuid REFERENCES vinops.field_issues(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(title)) BETWEEN 1 AND 255)
);

CREATE INDEX bim_viewpoints_model_idx ON vinops.bim_viewpoints (bim_model_id, created_at DESC);
CREATE INDEX bim_viewpoints_field_issue_idx ON vinops.bim_viewpoints (project_id, field_issue_id) WHERE field_issue_id IS NOT NULL;

-- 6. Table: vinops.bcf_topics (BCF Issue Coordination & Field Issue Integration)
CREATE TABLE vinops.bcf_topics (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  bim_model_id uuid NOT NULL REFERENCES vinops.bim_models(id) ON DELETE CASCADE,
  viewpoint_id uuid REFERENCES vinops.bim_viewpoints(id) ON DELETE SET NULL,
  field_issue_id uuid REFERENCES vinops.field_issues(id) ON DELETE SET NULL,
  title text NOT NULL,
  topic_type text NOT NULL DEFAULT 'Issue' CHECK (topic_type IN ('Issue', 'Clash', 'Inquiry', 'Remark', 'Request')),
  topic_status text NOT NULL DEFAULT 'Open' CHECK (topic_status IN ('Open', 'In Progress', 'Resolved', 'Closed')),
  assigned_to uuid REFERENCES vinops.users(id),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(title)) BETWEEN 1 AND 255)
);

CREATE INDEX bcf_topics_model_idx ON vinops.bcf_topics (bim_model_id, topic_status);
CREATE INDEX bcf_topics_field_issue_idx ON vinops.bcf_topics (project_id, field_issue_id) WHERE field_issue_id IS NOT NULL;

-- 7. AUDIT & SOFT DELETE PROTECTION TRIGGERS
DO $$
DECLARE
  target_tbl text;
BEGIN
  FOREACH target_tbl IN ARRAY ARRAY[
    'bim_models', 'bim_model_revisions', 'bim_elements', 'bim_element_links', 'bim_viewpoints', 'bcf_topics'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON vinops.%I FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete()',
      target_tbl || '_no_delete', target_tbl
    );
  END LOOP;
END;
$$;

-- Touch triggers
CREATE TRIGGER bim_models_touch
  BEFORE UPDATE ON vinops.bim_models
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER bim_model_revisions_touch
  BEFORE UPDATE ON vinops.bim_model_revisions
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER bim_viewpoints_touch
  BEFORE UPDATE ON vinops.bim_viewpoints
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER bcf_topics_touch
  BEFORE UPDATE ON vinops.bcf_topics
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

-- Version increment triggers
CREATE TRIGGER bim_models_version
  BEFORE UPDATE ON vinops.bim_models
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER bim_model_revisions_version
  BEFORE UPDATE ON vinops.bim_model_revisions
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER bim_viewpoints_version
  BEFORE UPDATE ON vinops.bim_viewpoints
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER bcf_topics_version
  BEFORE UPDATE ON vinops.bcf_topics
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE vinops.bim_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.bim_model_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.bim_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.bim_element_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.bim_viewpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.bcf_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY bim_models_tenant_isolation ON vinops.bim_models
  FOR ALL USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY bim_model_revisions_tenant_isolation ON vinops.bim_model_revisions
  FOR ALL USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY bim_elements_tenant_isolation ON vinops.bim_elements
  FOR ALL USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY bim_element_links_tenant_isolation ON vinops.bim_element_links
  FOR ALL USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY bim_viewpoints_tenant_isolation ON vinops.bim_viewpoints
  FOR ALL USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY bcf_topics_tenant_isolation ON vinops.bcf_topics
  FOR ALL USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

-- 9. Runtime Privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON vinops.bim_models, vinops.bim_model_revisions, vinops.bim_elements, vinops.bim_element_links, vinops.bim_viewpoints, vinops.bcf_topics TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.bim_models, vinops.bim_model_revisions, vinops.bim_elements TO vinops_worker;
