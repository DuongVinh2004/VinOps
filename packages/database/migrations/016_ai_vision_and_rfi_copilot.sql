-- Migration: 016_ai_vision_and_rfi_copilot.sql
-- Description: AI Computer Vision Defect Detection, pgvector Embeddings for RAG,
--              and RFI Copilot Draft Suggestions.
-- Schema: vinops
-- Standards: ADR-014, pgvector HNSW cosine similarity, Vietnamese Construction Codes (TCVN)

CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- 1. Table: vinops.ai_vision_jobs
-- Asynchronous Computer Vision defect detection jobs submitted by users/workflows
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.ai_vision_jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('inspection', 'field_issue', 'daily_log', 'standalone_upload')),
  source_entity_id uuid,
  file_id uuid NOT NULL REFERENCES vinops.file_objects(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  model_name text NOT NULL DEFAULT 'yolov11-construction-v1',
  model_version text NOT NULL DEFAULT '1.2.0',
  processing_duration_ms integer,
  error_message text,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);

CREATE INDEX ai_vision_jobs_tenant_idx ON vinops.ai_vision_jobs (organization_id, project_id);
CREATE INDEX ai_vision_jobs_file_idx ON vinops.ai_vision_jobs (file_id);
CREATE INDEX ai_vision_jobs_status_idx ON vinops.ai_vision_jobs (project_id, status);

-- -----------------------------------------------------------------------------
-- 2. Table: vinops.ai_detections
-- Detected defects / safety hazards with bounding boxes and review status
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.ai_detections (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  vision_job_id uuid NOT NULL REFERENCES vinops.ai_vision_jobs(id),
  detection_type text NOT NULL CHECK (detection_type IN (
    'crack', 'honeycomb', 'rebar_exposure', 'spalling', 'efflorescence',
    'water_leakage', 'no_helmet', 'no_vest', 'fall_hazard'
  )),
  confidence_score numeric(5, 4) NOT NULL CHECK (confidence_score BETWEEN 0.0000 AND 1.0000),
  bounding_box_x numeric(8, 6) NOT NULL CHECK (bounding_box_x BETWEEN 0.000000 AND 1.000000),
  bounding_box_y numeric(8, 6) NOT NULL CHECK (bounding_box_y BETWEEN 0.000000 AND 1.000000),
  bounding_box_w numeric(8, 6) NOT NULL CHECK (bounding_box_w BETWEEN 0.000000 AND 1.000000),
  bounding_box_h numeric(8, 6) NOT NULL CHECK (bounding_box_h BETWEEN 0.000000 AND 1.000000),
  review_status text NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('auto_tagged', 'pending_review', 'confirmed', 'rejected', 'discard')),
  reviewed_by uuid REFERENCES vinops.users(id),
  reviewed_at timestamptz,
  linked_field_issue_id uuid REFERENCES vinops.field_issues(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);

CREATE INDEX ai_detections_tenant_idx ON vinops.ai_detections (organization_id, project_id);
CREATE INDEX ai_detections_job_idx ON vinops.ai_detections (vision_job_id);
CREATE INDEX ai_detections_status_idx ON vinops.ai_detections (project_id, review_status);

-- -----------------------------------------------------------------------------
-- 3. Table: vinops.document_embeddings
-- High-dimensional semantic vectors for technical specs / TCVN / contract RAG
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.document_embeddings (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_revision_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  chunk_text text NOT NULL,
  token_count integer NOT NULL CHECK (token_count > 0),
  embedding vector(1536) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);

CREATE INDEX document_embeddings_tenant_idx ON vinops.document_embeddings (organization_id, project_id);
CREATE INDEX document_embeddings_doc_idx ON vinops.document_embeddings (document_id, document_revision_id);
CREATE INDEX document_embeddings_hnsw_idx ON vinops.document_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX document_embeddings_fts_idx ON vinops.document_embeddings USING gin (to_tsvector('simple', chunk_text));

-- -----------------------------------------------------------------------------
-- 4. Table: vinops.rfi_draft_suggestions
-- AI Copilot draft answers & technical recommendations for RFIs
-- -----------------------------------------------------------------------------
CREATE TABLE vinops.rfi_draft_suggestions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  rfi_id uuid NOT NULL REFERENCES vinops.rfi_requests(id),
  suggestion_type text NOT NULL CHECK (suggestion_type IN ('answer_draft', 'clarification_request', 'clause_recommendation')),
  content text NOT NULL,
  cited_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  llm_model text NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
  llm_prompt_tokens integer NOT NULL DEFAULT 0,
  llm_completion_tokens integer NOT NULL DEFAULT 0,
  confidence_score numeric(5, 4) NOT NULL CHECK (confidence_score BETWEEN 0.0000 AND 1.0000),
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'accepted', 'rejected')),
  accepted_by uuid REFERENCES vinops.users(id),
  accepted_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);

CREATE INDEX rfi_draft_suggestions_tenant_idx ON vinops.rfi_draft_suggestions (organization_id, project_id);
CREATE INDEX rfi_draft_suggestions_rfi_idx ON vinops.rfi_draft_suggestions (rfi_id);

-- -----------------------------------------------------------------------------
-- Audit & Concurrency Triggers
-- -----------------------------------------------------------------------------
CREATE TRIGGER ai_vision_jobs_touch
  BEFORE UPDATE ON vinops.ai_vision_jobs
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER ai_vision_jobs_version
  BEFORE UPDATE ON vinops.ai_vision_jobs
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER ai_vision_jobs_no_delete
  BEFORE DELETE ON vinops.ai_vision_jobs
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER ai_detections_touch
  BEFORE UPDATE ON vinops.ai_detections
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER ai_detections_version
  BEFORE UPDATE ON vinops.ai_detections
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER ai_detections_no_delete
  BEFORE DELETE ON vinops.ai_detections
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER document_embeddings_touch
  BEFORE UPDATE ON vinops.document_embeddings
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER document_embeddings_version
  BEFORE UPDATE ON vinops.document_embeddings
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER document_embeddings_no_delete
  BEFORE DELETE ON vinops.document_embeddings
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER rfi_draft_suggestions_touch
  BEFORE UPDATE ON vinops.rfi_draft_suggestions
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER rfi_draft_suggestions_version
  BEFORE UPDATE ON vinops.rfi_draft_suggestions
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER rfi_draft_suggestions_no_delete
  BEFORE DELETE ON vinops.rfi_draft_suggestions
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- -----------------------------------------------------------------------------
-- Row Level Security (RLS) Policies
-- -----------------------------------------------------------------------------
ALTER TABLE vinops.ai_vision_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.ai_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.rfi_draft_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_vision_jobs_tenant ON vinops.ai_vision_jobs
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY ai_detections_tenant ON vinops.ai_detections
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY document_embeddings_tenant ON vinops.document_embeddings
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY rfi_draft_suggestions_tenant ON vinops.rfi_draft_suggestions
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON vinops.ai_vision_jobs TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.ai_detections TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.document_embeddings TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.rfi_draft_suggestions TO vinops_app;

GRANT SELECT, INSERT, UPDATE ON vinops.ai_vision_jobs TO vinops_worker;
GRANT SELECT, INSERT, UPDATE ON vinops.ai_detections TO vinops_worker;
GRANT SELECT, INSERT, UPDATE ON vinops.document_embeddings TO vinops_worker;
