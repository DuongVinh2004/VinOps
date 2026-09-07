-- VIN-MEGA-002: production-shaped Document Control, file quarantine, review and distribution.
-- This is an expand-only migration. Existing VIN-MEGA-001 tables and contracts remain valid.

CREATE TABLE vinops.project_document_policies (
  project_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  revision_code_pattern text NOT NULL DEFAULT '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$',
  allowed_distribution_contexts text[] NOT NULL DEFAULT ARRAY['default'],
  allowed_media_types text[] NOT NULL DEFAULT ARRAY['application/pdf', 'image/png', 'image/jpeg'],
  maximum_file_bytes bigint NOT NULL DEFAULT 104857600 CHECK (maximum_file_bytes > 0),
  signed_url_ttl_seconds integer NOT NULL DEFAULT 60 CHECK (signed_url_ttl_seconds BETWEEN 15 AND 300),
  default_review_mode text NOT NULL DEFAULT 'sequential' CHECK (default_review_mode IN ('sequential', 'quorum')),
  default_reject_threshold integer NOT NULL DEFAULT 1 CHECK (default_reject_threshold > 0),
  policy_version bigint NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (cardinality(allowed_distribution_contexts) > 0),
  CHECK (cardinality(allowed_media_types) > 0)
);

CREATE TABLE vinops.documents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  numbering_context text NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  document_type text NOT NULL,
  discipline_id uuid,
  classification_id uuid,
  work_id uuid,
  confidentiality text NOT NULL DEFAULT 'project' CHECK (confidentiality IN ('internal', 'restricted', 'project')),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  sealed_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  FOREIGN KEY (discipline_id) REFERENCES vinops.disciplines(id),
  FOREIGN KEY (classification_id) REFERENCES vinops.document_classifications(id),
  FOREIGN KEY (work_id) REFERENCES vinops.work_nodes(id),
  UNIQUE (project_id, numbering_context, code),
  UNIQUE (project_id, id),
  CHECK (length(trim(numbering_context)) BETWEEN 1 AND 120),
  CHECK (length(trim(code)) BETWEEN 1 AND 120),
  CHECK (length(trim(title)) BETWEEN 1 AND 300),
  CHECK (length(trim(document_type)) BETWEEN 1 AND 120)
);
CREATE INDEX documents_search_idx ON vinops.documents (project_id, archived_at, code, title, id);
CREATE INDEX documents_scope_idx ON vinops.documents (project_id, discipline_id, classification_id, work_id);

CREATE TABLE vinops.file_objects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  storage_provider text NOT NULL,
  storage_bucket text NOT NULL,
  quarantine_object_key text NOT NULL,
  available_object_key text,
  original_filename text NOT NULL,
  declared_size_bytes bigint NOT NULL CHECK (declared_size_bytes > 0),
  actual_size_bytes bigint,
  declared_media_type text NOT NULL,
  detected_media_type text,
  declared_sha256 char(64) NOT NULL CHECK (declared_sha256 ~ '^[a-f0-9]{64}$'),
  actual_sha256 char(64),
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Uploading', 'Validating', 'Quarantined', 'Available', 'Rejected', 'Purged')),
  failure_code text,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz,
  sealed_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, id),
  UNIQUE (storage_bucket, quarantine_object_key),
  CHECK (length(trim(original_filename)) BETWEEN 1 AND 255),
  CHECK (actual_size_bytes IS NULL OR actual_size_bytes > 0),
  CHECK (actual_sha256 IS NULL OR actual_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK ((status <> 'Available') OR (available_object_key IS NOT NULL AND actual_sha256 IS NOT NULL AND available_at IS NOT NULL))
);
CREATE INDEX file_objects_duplicate_signal_idx
  ON vinops.file_objects (project_id, actual_sha256) WHERE status = 'Available';
CREATE INDEX file_objects_reconciliation_idx
  ON vinops.file_objects (status, updated_at) WHERE status IN ('Uploading', 'Validating', 'Quarantined');

CREATE TABLE vinops.upload_sessions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  file_id uuid NOT NULL,
  storage_upload_id text NOT NULL,
  credential_hash char(64) NOT NULL CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Completing', 'Completed', 'Expired', 'Aborted')),
  part_size_bytes integer NOT NULL CHECK (part_size_bytes >= 5242880),
  received_bytes bigint NOT NULL DEFAULT 0 CHECK (received_bytes >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (project_id, file_id) REFERENCES vinops.file_objects (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (file_id),
  CHECK (expires_at > created_at)
);
CREATE INDEX upload_sessions_expiry_idx ON vinops.upload_sessions (status, expires_at);

CREATE TABLE vinops.file_processing_jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  file_id uuid NOT NULL,
  job_type text NOT NULL CHECK (job_type IN ('validate_scan_preview', 'reconcile')),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Claimed', 'Retry', 'Completed', 'Failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (project_id, file_id) REFERENCES vinops.file_objects (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (file_id, job_type)
);
CREATE INDEX file_processing_jobs_claim_idx ON vinops.file_processing_jobs (status, available_at, created_at);

CREATE TABLE vinops.file_scan_results (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  file_id uuid NOT NULL,
  engine text NOT NULL,
  signature_version text NOT NULL,
  result text NOT NULL CHECK (result IN ('clean', 'infected', 'error')),
  threat_name text,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, file_id) REFERENCES vinops.file_objects (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);
CREATE INDEX file_scan_results_file_idx ON vinops.file_scan_results (file_id, scanned_at DESC);

CREATE TABLE vinops.file_derivatives (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  file_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('preview', 'thumbnail')),
  media_type text NOT NULL,
  storage_object_key text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, file_id) REFERENCES vinops.file_objects (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (file_id, kind),
  UNIQUE (storage_object_key)
);

CREATE TABLE vinops.document_revisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  document_id uuid NOT NULL,
  revision_code text NOT NULL,
  purpose text NOT NULL,
  suitability_code text,
  status text NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Under Review', 'Approved', 'Approved with Comments', 'Rejected', 'Published', 'Superseded', 'Withdrawn')),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  superseded_at timestamptz,
  withdrawn_at timestamptz,
  archived_at timestamptz,
  sealed_at timestamptz,
  FOREIGN KEY (project_id, document_id) REFERENCES vinops.documents (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (document_id, revision_code),
  UNIQUE (document_id, id),
  UNIQUE (project_id, id),
  CHECK (length(trim(revision_code)) BETWEEN 1 AND 60),
  CHECK (length(trim(purpose)) BETWEEN 1 AND 100)
);
CREATE INDEX document_revisions_history_idx ON vinops.document_revisions (document_id, created_at DESC, id DESC);

CREATE TABLE vinops.revision_file_versions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  technical_version integer NOT NULL CHECK (technical_version > 0),
  file_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, revision_id) REFERENCES vinops.document_revisions (project_id, id),
  FOREIGN KEY (project_id, file_id) REFERENCES vinops.file_objects (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (revision_id, technical_version),
  UNIQUE (file_id),
  UNIQUE (revision_id, id)
);

CREATE TABLE vinops.document_revision_current_files (
  revision_id uuid PRIMARY KEY,
  revision_file_version_id uuid NOT NULL UNIQUE,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (revision_file_version_id, revision_id)
    REFERENCES vinops.revision_file_versions (id, revision_id)
);

CREATE TABLE vinops.document_current_revisions (
  document_id uuid NOT NULL,
  context_key text NOT NULL,
  revision_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL REFERENCES vinops.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, context_key),
  FOREIGN KEY (revision_id, document_id) REFERENCES vinops.document_revisions (id, document_id),
  CHECK (length(trim(context_key)) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX document_current_revision_context_idx
  ON vinops.document_current_revisions (document_id, context_key, revision_id);

CREATE TABLE vinops.revision_review_routes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL UNIQUE,
  mode text NOT NULL CHECK (mode IN ('sequential', 'quorum')),
  required_approvals integer NOT NULL CHECK (required_approvals > 0),
  reject_threshold integer NOT NULL CHECK (reject_threshold > 0),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Complete', 'Rejected', 'Cancelled')),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  FOREIGN KEY (project_id, revision_id) REFERENCES vinops.document_revisions (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);

CREATE TABLE vinops.review_assignments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  route_id uuid NOT NULL REFERENCES vinops.revision_review_routes(id),
  reviewer_id uuid NOT NULL REFERENCES vinops.users(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  due_at timestamptz,
  delegated_from_user_id uuid REFERENCES vinops.users(id),
  delegation_id uuid REFERENCES vinops.delegations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (route_id, reviewer_id)
);
CREATE INDEX review_assignments_inbox_idx ON vinops.review_assignments (reviewer_id, due_at, route_id);

CREATE TABLE vinops.review_comments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES vinops.users(id),
  importance text NOT NULL CHECK (importance IN ('mandatory', 'advisory')),
  body text NOT NULL,
  page integer,
  x numeric(8,7),
  y numeric(8,7),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, revision_id) REFERENCES vinops.document_revisions (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (revision_id, id),
  CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  CHECK (page IS NULL OR page > 0),
  CHECK (x IS NULL OR (x >= 0 AND x <= 1)),
  CHECK (y IS NULL OR (y >= 0 AND y <= 1))
);

CREATE TABLE vinops.review_comment_dispositions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  comment_id uuid NOT NULL UNIQUE,
  disposition text NOT NULL CHECK (disposition IN ('accepted', 'incorporated', 'noted', 'rejected_with_reason')),
  response text NOT NULL,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (comment_id, revision_id) REFERENCES vinops.review_comments (id, revision_id),
  FOREIGN KEY (project_id, revision_id) REFERENCES vinops.document_revisions (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(response)) BETWEEN 1 AND 4000)
);

CREATE TABLE vinops.review_decisions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  assignment_id uuid NOT NULL UNIQUE REFERENCES vinops.review_assignments(id),
  reviewer_id uuid NOT NULL REFERENCES vinops.users(id),
  decision text NOT NULL CHECK (decision IN ('approve', 'approve_with_comments', 'reject')),
  reason text,
  effective_roles text[] NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid NOT NULL,
  FOREIGN KEY (project_id, revision_id) REFERENCES vinops.document_revisions (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (cardinality(effective_roles) > 0),
  CHECK ((decision <> 'reject') OR length(trim(reason)) > 0)
);
CREATE INDEX review_decisions_revision_idx ON vinops.review_decisions (revision_id, decided_at, id);

CREATE TABLE vinops.revision_transition_history (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  action text NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  reason text,
  actor_user_id uuid NOT NULL REFERENCES vinops.users(id),
  effective_roles text[] NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version > 0),
  resulting_version bigint NOT NULL CHECK (resulting_version > expected_version),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, revision_id) REFERENCES vinops.document_revisions (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);
CREATE INDEX revision_transition_history_idx ON vinops.revision_transition_history (revision_id, occurred_at, id);

CREATE TABLE vinops.annotations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  page integer NOT NULL CHECK (page > 0),
  x numeric(8,7) NOT NULL CHECK (x >= 0 AND x <= 1),
  y numeric(8,7) NOT NULL CHECK (y >= 0 AND y <= 1),
  kind text NOT NULL CHECK (kind IN ('pin', 'note', 'highlight', 'area')),
  body text,
  linked_entity_type text,
  linked_entity_id uuid,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, revision_id) REFERENCES vinops.document_revisions (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (body IS NULL OR length(body) <= 4000),
  CHECK ((linked_entity_type IS NULL) = (linked_entity_id IS NULL))
);
CREATE INDEX annotations_revision_page_idx ON vinops.annotations (revision_id, page, created_at, id);

CREATE TABLE vinops.transmittals (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL DEFAULT 'Issued' CHECK (status IN ('Draft', 'Issued', 'Acknowledged', 'Cancelled')),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_at timestamptz,
  snapshot_sha256 char(64),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  UNIQUE (project_id, id),
  CHECK (length(trim(code)) BETWEEN 1 AND 120),
  CHECK (length(trim(purpose)) BETWEEN 1 AND 2000),
  CHECK (snapshot_sha256 IS NULL OR snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK ((status = 'Draft') OR (issued_at IS NOT NULL AND snapshot_sha256 IS NOT NULL))
);

CREATE TABLE vinops.transmittal_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transmittal_id uuid NOT NULL,
  document_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  context_key text NOT NULL,
  document_code_snapshot text NOT NULL,
  document_title_snapshot text NOT NULL,
  revision_code_snapshot text NOT NULL,
  file_sha256_snapshot char(64) NOT NULL CHECK (file_sha256_snapshot ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, transmittal_id) REFERENCES vinops.transmittals (project_id, id),
  FOREIGN KEY (revision_id, document_id) REFERENCES vinops.document_revisions (id, document_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (transmittal_id, revision_id, context_key)
);

CREATE TABLE vinops.transmittal_recipients (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  transmittal_id uuid NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('user', 'organization', 'external')),
  recipient_reference text NOT NULL,
  recipient_name_snapshot text NOT NULL,
  recipient_address_snapshot text,
  sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, transmittal_id) REFERENCES vinops.transmittals (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(recipient_reference)) > 0),
  CHECK (length(trim(recipient_name_snapshot)) > 0)
);

CREATE TABLE vinops.transmittal_acknowledgments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  recipient_id uuid NOT NULL UNIQUE REFERENCES vinops.transmittal_recipients(id),
  acknowledged_by text NOT NULL,
  acknowledged_at timestamptz NOT NULL,
  evidence_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(acknowledged_by)) > 0)
);

CREATE TABLE vinops.file_access_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  file_id uuid NOT NULL,
  revision_id uuid,
  actor_user_id uuid NOT NULL REFERENCES vinops.users(id),
  access_kind text NOT NULL CHECK (access_kind IN ('preview', 'download')),
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied')),
  expires_at timestamptz,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, file_id) REFERENCES vinops.file_objects (project_id, id),
  FOREIGN KEY (project_id, revision_id) REFERENCES vinops.document_revisions (project_id, id),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);
CREATE INDEX file_access_events_file_idx ON vinops.file_access_events (file_id, occurred_at DESC, id);

CREATE FUNCTION vinops.can_access_document_scope(
  p_project_id uuid,
  p_discipline_id uuid,
  p_classification_id uuid,
  p_work_id uuid,
  p_action text DEFAULT 'read',
  p_user_id uuid DEFAULT vinops.current_actor_id()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT vinops.can_access_project(p_project_id, p_user_id)
     AND CASE
       WHEN p_discipline_id IS NULL AND p_classification_id IS NULL AND p_work_id IS NULL
         THEN vinops.can_read_scoped_resource(p_project_id, 'project', p_project_id, p_action, p_user_id)
       ELSE
         (p_discipline_id IS NULL OR vinops.can_read_scoped_resource(p_project_id, 'discipline', p_discipline_id, p_action, p_user_id))
         AND (p_classification_id IS NULL OR vinops.can_read_scoped_resource(p_project_id, 'classification', p_classification_id, p_action, p_user_id))
         AND (p_work_id IS NULL OR vinops.can_read_scoped_resource(p_project_id, 'work', p_work_id, p_action, p_user_id))
     END;
$$;

CREATE FUNCTION vinops.can_access_document(
  p_document_id uuid,
  p_action text DEFAULT 'read',
  p_user_id uuid DEFAULT vinops.current_actor_id()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1 FROM vinops.documents document
     WHERE document.id = p_document_id
       AND vinops.can_access_document_scope(
         document.project_id,
         document.discipline_id,
         document.classification_id,
         document.work_id,
         p_action,
         p_user_id
       )
  );
$$;

CREATE FUNCTION vinops.prevent_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_HISTORY' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE FUNCTION vinops.protect_sealed_file() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sealed_at IS NOT NULL AND (
    NEW.quarantine_object_key IS DISTINCT FROM OLD.quarantine_object_key OR
    NEW.available_object_key IS DISTINCT FROM OLD.available_object_key OR
    NEW.actual_size_bytes IS DISTINCT FROM OLD.actual_size_bytes OR
    NEW.actual_sha256 IS DISTINCT FROM OLD.actual_sha256 OR
    NEW.detected_media_type IS DISTINCT FROM OLD.detected_media_type
  ) THEN
    RAISE EXCEPTION 'SEALED_FILE_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION vinops.protect_issued_transmittal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.issued_at IS NOT NULL AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
    RAISE EXCEPTION 'TRANSMITTAL_SNAPSHOT_IMMUTABLE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION vinops.publish_document_revision(
  p_revision_id uuid,
  p_context_key text,
  p_expected_revision_version bigint,
  p_expected_current_version bigint,
  p_actor_user_id uuid,
  p_correlation_id uuid,
  p_fail_before_commit boolean DEFAULT false
) RETURNS TABLE (revision_id uuid, revision_version bigint, current_version bigint, superseded_revision_id uuid)
LANGUAGE plpgsql AS $$
DECLARE
  candidate vinops.document_revisions%ROWTYPE;
  route vinops.revision_review_routes%ROWTYPE;
  candidate_file vinops.file_objects%ROWTYPE;
  pointer vinops.document_current_revisions%ROWTYPE;
  old_revision_id uuid;
  new_revision_version bigint;
  new_current_version bigint;
  roles_snapshot text[];
BEGIN
  SELECT * INTO candidate FROM vinops.document_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVISION_NOT_VISIBLE' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM vinops.documents WHERE id = candidate.document_id FOR UPDATE;
  IF candidate.version <> p_expected_revision_version THEN
    RAISE EXCEPTION 'REVISION_VERSION_CONFLICT' USING ERRCODE = 'serialization_failure';
  END IF;
  IF candidate.status NOT IN ('Approved', 'Approved with Comments') THEN
    RAISE EXCEPTION 'REVISION_NOT_APPROVED' USING ERRCODE = 'check_violation';
  END IF;
  IF candidate.created_by = p_actor_user_id THEN
    RAISE EXCEPTION 'MAKER_CHECKER_VIOLATION' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO route FROM vinops.revision_review_routes WHERE revision_id = candidate.id;
  IF NOT FOUND OR route.status <> 'Complete' THEN
    RAISE EXCEPTION 'REVIEW_ROUTE_INCOMPLETE' USING ERRCODE = 'check_violation';
  END IF;
  IF candidate.status = 'Approved with Comments' AND EXISTS (
    SELECT 1 FROM vinops.review_comments comment
     WHERE comment.revision_id = candidate.id AND comment.importance = 'mandatory'
       AND NOT EXISTS (SELECT 1 FROM vinops.review_comment_dispositions disposition WHERE disposition.comment_id = comment.id)
  ) THEN
    RAISE EXCEPTION 'MANDATORY_COMMENT_DISPOSITION_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT file.* INTO candidate_file
    FROM vinops.document_revision_current_files current_file
    JOIN vinops.revision_file_versions file_version ON file_version.id = current_file.revision_file_version_id
    JOIN vinops.file_objects file ON file.id = file_version.file_id
   WHERE current_file.revision_id = candidate.id;
  IF NOT FOUND OR candidate_file.status <> 'Available' THEN
    RAISE EXCEPTION 'FILE_NOT_AVAILABLE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO pointer FROM vinops.document_current_revisions
   WHERE document_id = candidate.document_id AND context_key = p_context_key FOR UPDATE;
  IF FOUND THEN
    IF pointer.version <> p_expected_current_version THEN
      RAISE EXCEPTION 'CURRENT_VERSION_CONFLICT' USING ERRCODE = 'serialization_failure';
    END IF;
    old_revision_id := pointer.revision_id;
  ELSE
    IF p_expected_current_version <> 0 THEN
      RAISE EXCEPTION 'CURRENT_VERSION_CONFLICT' USING ERRCODE = 'serialization_failure';
    END IF;
    old_revision_id := NULL;
  END IF;

  UPDATE vinops.document_revisions
     SET status = 'Published', published_at = now()
   WHERE id = candidate.id
   RETURNING version INTO new_revision_version;

  IF old_revision_id IS NOT NULL AND old_revision_id <> candidate.id THEN
    UPDATE vinops.document_revisions
       SET status = 'Superseded', superseded_at = now()
     WHERE id = old_revision_id AND status = 'Published';
  END IF;

  INSERT INTO vinops.document_current_revisions (document_id, context_key, revision_id, updated_by)
  VALUES (candidate.document_id, p_context_key, candidate.id, p_actor_user_id)
  ON CONFLICT (document_id, context_key) DO UPDATE
    SET revision_id = EXCLUDED.revision_id, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING version INTO new_current_version;

  SELECT COALESCE(membership.roles, ARRAY[]::text[]) INTO roles_snapshot
    FROM vinops.project_members membership
   WHERE membership.project_id = candidate.project_id AND membership.user_id = p_actor_user_id
     AND membership.status = 'Active';
  roles_snapshot := COALESCE(roles_snapshot, ARRAY[]::text[]);

  INSERT INTO vinops.revision_transition_history (
    id, organization_id, project_id, revision_id, action, from_state, to_state,
    actor_user_id, effective_roles, expected_version, resulting_version, correlation_id
  ) VALUES (
    gen_random_uuid(), candidate.organization_id, candidate.project_id, candidate.id, 'publish',
    candidate.status, 'Published', p_actor_user_id, roles_snapshot,
    p_expected_revision_version, new_revision_version, p_correlation_id
  );
  INSERT INTO vinops.audit_events (
    id, organization_id, project_id, actor_user_id, effective_roles, action, entity_type,
    entity_id, entity_version, outcome, correlation_id
  ) VALUES (
    gen_random_uuid(), candidate.organization_id, candidate.project_id, p_actor_user_id, roles_snapshot,
    'revision.publish', 'document_revision', candidate.id, new_revision_version, 'success', p_correlation_id
  );
  INSERT INTO vinops.outbox_events (
    id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    gen_random_uuid(), candidate.organization_id, candidate.project_id, 'document_revision', candidate.id,
    'revision.published.v1', jsonb_build_object(
      'revision_id', candidate.id,
      'document_id', candidate.document_id,
      'context_key', p_context_key,
      'superseded_revision_id', old_revision_id
    )
  );

  IF p_fail_before_commit THEN
    RAISE EXCEPTION 'TEST_FAILURE_BEFORE_COMMIT' USING ERRCODE = 'raise_exception';
  END IF;
  RETURN QUERY SELECT candidate.id, new_revision_version, new_current_version, old_revision_id;
END;
$$;

CREATE FUNCTION vinops.claim_file_processing_jobs(p_worker_name text, p_limit integer)
RETURNS TABLE (
  job_id uuid,
  file_id uuid,
  organization_id uuid,
  project_id uuid,
  storage_bucket text,
  quarantine_object_key text,
  declared_size_bytes bigint,
  declared_media_type text,
  declared_sha256 char(64),
  original_filename text,
  attempts integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT job.id FROM vinops.file_processing_jobs job
     WHERE job.status IN ('Pending', 'Retry') AND job.available_at <= now()
     ORDER BY job.available_at, job.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(p_limit, 100))
  ), claimed AS (
    UPDATE vinops.file_processing_jobs job
       SET status = 'Claimed', claimed_at = now(), claimed_by = p_worker_name, attempts = job.attempts + 1
      FROM candidates WHERE job.id = candidates.id
      RETURNING job.*
  )
  SELECT claimed.id, file.id, file.organization_id, file.project_id, file.storage_bucket,
         file.quarantine_object_key, file.declared_size_bytes, file.declared_media_type,
         file.declared_sha256, file.original_filename, claimed.attempts
    FROM claimed JOIN vinops.file_objects file ON file.id = claimed.file_id;
END;
$$;

CREATE FUNCTION vinops.complete_file_processing(
  p_job_id uuid,
  p_file_id uuid,
  p_worker_name text,
  p_result text,
  p_failure_code text,
  p_actual_size_bytes bigint,
  p_actual_sha256 char(64),
  p_detected_media_type text,
  p_available_object_key text,
  p_scan_engine text,
  p_signature_version text,
  p_threat_name text,
  p_preview_object_key text,
  p_preview_media_type text,
  p_preview_size_bytes bigint,
  p_preview_sha256 char(64)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
DECLARE
  file vinops.file_objects%ROWTYPE;
BEGIN
  SELECT * INTO file FROM vinops.file_objects WHERE id = p_file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vinops.file_processing_jobs job
     WHERE job.id = p_job_id AND job.file_id = p_file_id AND job.status = 'Claimed' AND job.claimed_by = p_worker_name
  ) THEN RAISE EXCEPTION 'FILE_JOB_NOT_CLAIMED'; END IF;

  INSERT INTO vinops.file_scan_results (
    id, organization_id, project_id, file_id, engine, signature_version, result, threat_name
  ) VALUES (
    gen_random_uuid(), file.organization_id, file.project_id, file.id,
    p_scan_engine, p_signature_version,
    CASE WHEN p_result = 'Available' THEN 'clean' WHEN p_result = 'Rejected' THEN 'infected' ELSE 'error' END,
    p_threat_name
  );

  IF p_result = 'Available' THEN
    UPDATE vinops.file_objects SET
      status = 'Available', failure_code = NULL, actual_size_bytes = p_actual_size_bytes,
      actual_sha256 = p_actual_sha256, detected_media_type = p_detected_media_type,
      available_object_key = p_available_object_key, available_at = now()
     WHERE id = p_file_id;
    IF p_preview_object_key IS NOT NULL THEN
      INSERT INTO vinops.file_derivatives (
        id, organization_id, project_id, file_id, kind, media_type, storage_object_key, size_bytes, sha256
      ) VALUES (
        gen_random_uuid(), file.organization_id, file.project_id, file.id, 'preview',
        p_preview_media_type, p_preview_object_key, p_preview_size_bytes, p_preview_sha256
      ) ON CONFLICT (file_id, kind) DO NOTHING;
    END IF;
    INSERT INTO vinops.outbox_events (
      id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
    ) VALUES (
      gen_random_uuid(), file.organization_id, file.project_id, 'file_object', file.id,
      'file.available.v1', jsonb_build_object('file_id', file.id)
    );
  ELSE
    UPDATE vinops.file_objects SET
      status = CASE WHEN p_result IN ('Rejected', 'Quarantined') THEN p_result ELSE 'Quarantined' END,
      failure_code = p_failure_code, actual_size_bytes = p_actual_size_bytes,
      actual_sha256 = p_actual_sha256, detected_media_type = p_detected_media_type
     WHERE id = p_file_id;
    INSERT INTO vinops.outbox_events (
      id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
    ) VALUES (
      gen_random_uuid(), file.organization_id, file.project_id, 'file_object', file.id,
      'file.rejected.v1', jsonb_build_object('file_id', file.id, 'failure_code', p_failure_code)
    );
  END IF;
  UPDATE vinops.file_processing_jobs SET status = 'Completed', completed_at = now()
   WHERE id = p_job_id;
END;
$$;

CREATE FUNCTION vinops.retry_file_processing_job(
  p_job_id uuid,
  p_worker_name text,
  p_error_code text,
  p_retry_at timestamptz
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
BEGIN
  UPDATE vinops.file_processing_jobs
     SET status = CASE WHEN p_retry_at IS NULL THEN 'Failed' ELSE 'Retry' END,
         last_error_code = p_error_code, available_at = COALESCE(p_retry_at, available_at),
         claimed_at = NULL, claimed_by = NULL
   WHERE id = p_job_id AND status = 'Claimed' AND claimed_by = p_worker_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_JOB_NOT_CLAIMED'; END IF;
END;
$$;

CREATE TRIGGER project_document_policies_touch BEFORE UPDATE ON vinops.project_document_policies
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER documents_touch BEFORE UPDATE ON vinops.documents FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER documents_version BEFORE UPDATE ON vinops.documents FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER file_objects_touch BEFORE UPDATE ON vinops.file_objects FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER file_objects_version BEFORE UPDATE ON vinops.file_objects FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER file_objects_sealed_guard BEFORE UPDATE ON vinops.file_objects FOR EACH ROW EXECUTE FUNCTION vinops.protect_sealed_file();
CREATE TRIGGER document_revisions_touch BEFORE UPDATE ON vinops.document_revisions FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER document_revisions_version BEFORE UPDATE ON vinops.document_revisions FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER current_files_version BEFORE UPDATE ON vinops.document_revision_current_files FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER current_revisions_version BEFORE UPDATE ON vinops.document_current_revisions FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER transmittals_version BEFORE UPDATE ON vinops.transmittals FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER transmittals_issued_guard BEFORE UPDATE ON vinops.transmittals FOR EACH ROW EXECUTE FUNCTION vinops.protect_issued_transmittal();

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'project_document_policies', 'documents', 'file_objects', 'upload_sessions', 'file_processing_jobs',
    'file_scan_results', 'file_derivatives', 'document_revisions', 'revision_file_versions',
    'document_revision_current_files', 'document_current_revisions', 'revision_review_routes',
    'review_assignments', 'review_comments', 'review_comment_dispositions', 'review_decisions',
    'revision_transition_history', 'annotations', 'transmittals', 'transmittal_items',
    'transmittal_recipients', 'transmittal_acknowledgments', 'file_access_events'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON vinops.%I FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete()',
      target_table || '_no_delete', target_table);
  END LOOP;
  FOREACH target_table IN ARRAY ARRAY[
    'file_scan_results', 'file_derivatives', 'revision_file_versions', 'review_comments',
    'review_comment_dispositions', 'review_decisions', 'revision_transition_history', 'annotations',
    'transmittal_items', 'transmittal_recipients', 'transmittal_acknowledgments', 'file_access_events'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON vinops.%I FOR EACH ROW EXECUTE FUNCTION vinops.prevent_history_mutation()',
      target_table || '_no_update', target_table);
  END LOOP;
END;
$$;

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'project_document_policies', 'documents', 'file_objects', 'upload_sessions', 'file_processing_jobs',
    'file_scan_results', 'file_derivatives', 'document_revisions', 'revision_file_versions',
    'document_revision_current_files', 'document_current_revisions', 'revision_review_routes',
    'review_assignments', 'review_comments', 'review_comment_dispositions', 'review_decisions',
    'revision_transition_history', 'annotations', 'transmittals', 'transmittal_items',
    'transmittal_recipients', 'transmittal_acknowledgments', 'file_access_events'
  ] LOOP
    EXECUTE format('ALTER TABLE vinops.%I ENABLE ROW LEVEL SECURITY', target_table);
  END LOOP;
END;
$$;

CREATE POLICY project_document_policies_visible ON vinops.project_document_policies
  USING (vinops.can_access_project(project_id)) WITH CHECK (vinops.can_manage_project_context(project_id));
CREATE POLICY documents_scoped ON vinops.documents
  USING (vinops.can_access_document_scope(project_id, discipline_id, classification_id, work_id))
  WITH CHECK (vinops.can_access_document_scope(project_id, discipline_id, classification_id, work_id));

CREATE POLICY file_objects_scoped ON vinops.file_objects
  USING (
    created_by = vinops.current_actor_id()
    OR EXISTS (
      SELECT 1 FROM vinops.revision_file_versions file_version
      JOIN vinops.document_revisions revision ON revision.id = file_version.revision_id
      WHERE file_version.file_id = file_objects.id AND vinops.can_access_document(revision.document_id)
    )
  )
  WITH CHECK (created_by = vinops.current_actor_id() AND vinops.can_access_project(project_id));

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['upload_sessions', 'file_processing_jobs', 'file_scan_results', 'file_derivatives'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON vinops.%I USING (EXISTS (SELECT 1 FROM vinops.revision_file_versions fv JOIN vinops.document_revisions r ON r.id = fv.revision_id JOIN vinops.documents d ON d.id = r.document_id WHERE fv.file_id = %I.file_id AND vinops.can_access_document(d.id))) WITH CHECK (vinops.can_access_project(project_id))',
      target_table || '_scoped', target_table, target_table
    );
  END LOOP;
END;
$$;

CREATE POLICY document_revisions_scoped ON vinops.document_revisions
  USING (vinops.can_access_document(document_id)) WITH CHECK (vinops.can_access_document(document_id));
CREATE POLICY revision_file_versions_scoped ON vinops.revision_file_versions
  USING (EXISTS (SELECT 1 FROM vinops.document_revisions r WHERE r.id = revision_id AND vinops.can_access_document(r.document_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.document_revisions r WHERE r.id = revision_id AND vinops.can_access_document(r.document_id)));
CREATE POLICY current_files_scoped ON vinops.document_revision_current_files
  USING (EXISTS (SELECT 1 FROM vinops.document_revisions r WHERE r.id = revision_id AND vinops.can_access_document(r.document_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.document_revisions r WHERE r.id = revision_id AND vinops.can_access_document(r.document_id)));
CREATE POLICY current_revisions_scoped ON vinops.document_current_revisions
  USING (vinops.can_access_document(document_id)) WITH CHECK (vinops.can_access_document(document_id));

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'revision_review_routes', 'review_comments', 'review_comment_dispositions', 'review_decisions',
    'revision_transition_history', 'annotations'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON vinops.%I USING (EXISTS (SELECT 1 FROM vinops.document_revisions r WHERE r.id = %I.revision_id AND vinops.can_access_document(r.document_id))) WITH CHECK (EXISTS (SELECT 1 FROM vinops.document_revisions r WHERE r.id = %I.revision_id AND vinops.can_access_document(r.document_id)))',
      target_table || '_scoped', target_table, target_table, target_table
    );
  END LOOP;
END;
$$;

CREATE POLICY review_assignments_scoped ON vinops.review_assignments
  USING (reviewer_id = vinops.current_actor_id() OR EXISTS (
    SELECT 1 FROM vinops.revision_review_routes route JOIN vinops.document_revisions revision ON revision.id = route.revision_id
     WHERE route.id = route_id AND vinops.can_access_document(revision.document_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM vinops.revision_review_routes route JOIN vinops.document_revisions revision ON revision.id = route.revision_id
     WHERE route.id = route_id AND vinops.can_access_document(revision.document_id)
  ));

CREATE POLICY transmittals_scoped ON vinops.transmittals
  USING (
    created_by = vinops.current_actor_id()
    OR (
      EXISTS (SELECT 1 FROM vinops.transmittal_items item WHERE item.transmittal_id = transmittals.id)
      AND NOT EXISTS (
        SELECT 1 FROM vinops.transmittal_items item
         WHERE item.transmittal_id = transmittals.id AND NOT vinops.can_access_document(item.document_id)
      )
    )
  )
  WITH CHECK (created_by = vinops.current_actor_id() AND vinops.can_access_project(project_id));
DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['transmittal_items', 'transmittal_recipients'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON vinops.%I USING (EXISTS (SELECT 1 FROM vinops.transmittals t WHERE t.id = %I.transmittal_id AND vinops.can_access_project(t.project_id))) WITH CHECK (vinops.can_access_project(project_id))',
      target_table || '_scoped', target_table, target_table
    );
  END LOOP;
END;
$$;
CREATE POLICY transmittal_acknowledgments_scoped ON vinops.transmittal_acknowledgments
  USING (vinops.can_access_project(project_id)) WITH CHECK (vinops.can_access_project(project_id));
CREATE POLICY file_access_events_scoped ON vinops.file_access_events
  USING (actor_user_id = vinops.current_actor_id() OR vinops.can_access_project(project_id))
  WITH CHECK (actor_user_id = vinops.current_actor_id());

GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA vinops TO vinops_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA vinops FROM vinops_app;
REVOKE ALL ON FUNCTION vinops.can_access_document_scope(uuid, uuid, uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION vinops.can_access_document(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION vinops.publish_document_revision(uuid, text, bigint, bigint, uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION vinops.claim_file_processing_jobs(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vinops.complete_file_processing(uuid, uuid, text, text, text, bigint, char, text, text, text, text, text, text, text, bigint, char) FROM PUBLIC;
REVOKE ALL ON FUNCTION vinops.retry_file_processing_job(uuid, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.can_access_document_scope(uuid, uuid, uuid, uuid, text, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.can_access_document(uuid, text, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.publish_document_revision(uuid, text, bigint, bigint, uuid, uuid, boolean) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.claim_file_processing_jobs(text, integer) TO vinops_worker;
GRANT EXECUTE ON FUNCTION vinops.complete_file_processing(uuid, uuid, text, text, text, bigint, char, text, text, text, text, text, text, text, bigint, char) TO vinops_worker;
GRANT EXECUTE ON FUNCTION vinops.retry_file_processing_job(uuid, text, text, timestamptz) TO vinops_worker;

ALTER FUNCTION vinops.can_access_document_scope(uuid, uuid, uuid, uuid, text, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.can_access_document(uuid, text, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.publish_document_revision(uuid, text, bigint, bigint, uuid, uuid, boolean) OWNER TO vinops_owner;
ALTER FUNCTION vinops.claim_file_processing_jobs(text, integer) OWNER TO vinops_owner;
ALTER FUNCTION vinops.complete_file_processing(uuid, uuid, text, text, text, bigint, char, text, text, text, text, text, text, text, bigint, char) OWNER TO vinops_owner;
ALTER FUNCTION vinops.retry_file_processing_job(uuid, text, text, timestamptz) OWNER TO vinops_owner;

DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'project_document_policies', 'documents', 'file_objects', 'upload_sessions', 'file_processing_jobs',
    'file_scan_results', 'file_derivatives', 'document_revisions', 'revision_file_versions',
    'document_revision_current_files', 'document_current_revisions', 'revision_review_routes',
    'review_assignments', 'review_comments', 'review_comment_dispositions', 'review_decisions',
    'revision_transition_history', 'annotations', 'transmittals', 'transmittal_items',
    'transmittal_recipients', 'transmittal_acknowledgments', 'file_access_events'
  ] LOOP
    EXECUTE format('ALTER TABLE vinops.%I OWNER TO vinops_owner', target_table);
  END LOOP;
END;
$$;
