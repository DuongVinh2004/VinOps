-- VIN-MEGA-SLICE-A: Document Control LBS integration, FTS and indexing optimization, and scoped RLS enhancement.

-- 1. Add location_id to vinops.documents for Location Breakdown Structure (LBS)
ALTER TABLE vinops.documents
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES vinops.location_nodes(id);

-- 2. Optimal indexes for Discipline, LBS, WBS, Document Type and Full-text search
CREATE INDEX IF NOT EXISTS documents_discipline_idx
  ON vinops.documents (project_id, discipline_id);

CREATE INDEX IF NOT EXISTS documents_location_idx
  ON vinops.documents (project_id, location_id);

CREATE INDEX IF NOT EXISTS documents_work_idx
  ON vinops.documents (project_id, work_id);

CREATE INDEX IF NOT EXISTS documents_doc_type_idx
  ON vinops.documents (project_id, document_type);

CREATE INDEX IF NOT EXISTS documents_title_fts_idx
  ON vinops.documents USING gin (to_tsvector('simple', title));

-- 3. Update can_access_document_scope to support LBS scoping
CREATE OR REPLACE FUNCTION vinops.can_access_document_scope(
  p_project_id uuid,
  p_discipline_id uuid,
  p_classification_id uuid,
  p_work_id uuid,
  p_action text,
  p_user_id uuid,
  p_location_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT vinops.can_access_project(p_project_id, p_user_id)
     AND CASE
       WHEN p_discipline_id IS NULL AND p_classification_id IS NULL AND p_work_id IS NULL AND p_location_id IS NULL
         THEN vinops.can_read_scoped_resource(p_project_id, 'project', p_project_id, p_action, p_user_id)
       ELSE
         (p_discipline_id IS NULL OR vinops.can_read_scoped_resource(p_project_id, 'discipline', p_discipline_id, p_action, p_user_id))
         AND (p_classification_id IS NULL OR vinops.can_read_scoped_resource(p_project_id, 'classification', p_classification_id, p_action, p_user_id))
         AND (p_work_id IS NULL OR vinops.can_read_scoped_resource(p_project_id, 'work', p_work_id, p_action, p_user_id))
         AND (p_location_id IS NULL OR vinops.can_read_scoped_resource(p_project_id, 'location', p_location_id, p_action, p_user_id))
     END;
$$;

CREATE OR REPLACE FUNCTION vinops.can_access_document_scope(
  p_project_id uuid,
  p_discipline_id uuid,
  p_classification_id uuid,
  p_work_id uuid,
  p_action text DEFAULT 'read',
  p_user_id uuid DEFAULT vinops.current_actor_id()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT vinops.can_access_document_scope(p_project_id, p_discipline_id, p_classification_id, p_work_id, p_action, p_user_id, NULL);
$$;

CREATE OR REPLACE FUNCTION vinops.can_access_document(
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
         p_user_id,
         document.location_id
       )
  );
$$;

-- 4. Update RLS policy on vinops.documents
DROP POLICY IF EXISTS documents_scoped ON vinops.documents;

CREATE POLICY documents_scoped ON vinops.documents
  USING (vinops.can_access_document_scope(project_id, discipline_id, classification_id, work_id, 'read', vinops.current_actor_id(), location_id))
  WITH CHECK (vinops.can_access_document_scope(project_id, discipline_id, classification_id, work_id, 'document.create', vinops.current_actor_id(), location_id));

-- 5. Privileges and ownership
REVOKE ALL ON FUNCTION vinops.can_access_document_scope(uuid, uuid, uuid, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.can_access_document_scope(uuid, uuid, uuid, uuid, text, uuid, uuid) TO vinops_app;
ALTER FUNCTION vinops.can_access_document_scope(uuid, uuid, uuid, uuid, text, uuid, uuid) OWNER TO vinops_owner;

-- 6. Stored functions for quarantine and upload session cleanup
CREATE OR REPLACE FUNCTION vinops.cleanup_expired_upload_sessions(
  p_now timestamptz DEFAULT clock_timestamp()
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE vinops.upload_sessions
     SET status = 'Expired'
   WHERE status = 'Open' AND expires_at < p_now;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION vinops.claim_expired_quarantine_files(
  p_cutoff timestamptz,
  p_limit integer DEFAULT 50
) RETURNS TABLE (
  id uuid,
  quarantine_object_key text
)
LANGUAGE sql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT id, quarantine_object_key
    FROM vinops.file_objects
   WHERE status IN ('Quarantined', 'Rejected')
     AND created_at < p_cutoff
   ORDER BY created_at
   LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION vinops.purge_quarantine_file(
  p_file_id uuid,
  p_failure_code text DEFAULT 'QUARANTINE_EXPIRED_PURGED'
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
BEGIN
  UPDATE vinops.file_objects
     SET status = 'Purged',
         failure_code = COALESCE(failure_code, p_failure_code)
   WHERE id = p_file_id AND status <> 'Available';
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION vinops.cleanup_expired_upload_sessions(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vinops.claim_expired_quarantine_files(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vinops.purge_quarantine_file(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vinops.cleanup_expired_upload_sessions(timestamptz) TO vinops_worker;
GRANT EXECUTE ON FUNCTION vinops.claim_expired_quarantine_files(timestamptz, integer) TO vinops_worker;
GRANT EXECUTE ON FUNCTION vinops.purge_quarantine_file(uuid, text) TO vinops_worker;

ALTER FUNCTION vinops.cleanup_expired_upload_sessions(timestamptz) OWNER TO vinops_owner;
ALTER FUNCTION vinops.claim_expired_quarantine_files(timestamptz, integer) OWNER TO vinops_owner;
ALTER FUNCTION vinops.purge_quarantine_file(uuid, text) OWNER TO vinops_owner;

