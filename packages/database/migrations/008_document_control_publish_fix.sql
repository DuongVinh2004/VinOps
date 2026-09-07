-- VIN-MEGA-002: qualify the publish route lookup and provision a default
-- document policy for existing and newly-created projects.

INSERT INTO vinops.project_document_policies (project_id, organization_id)
SELECT project.id, project.organization_id
  FROM vinops.projects AS project
ON CONFLICT (project_id) DO NOTHING;

CREATE FUNCTION vinops.create_default_project_document_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = vinops, pg_catalog
AS $$
BEGIN
  INSERT INTO vinops.project_document_policies (project_id, organization_id)
  VALUES (NEW.id, NEW.organization_id)
  ON CONFLICT (project_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_default_document_policy
AFTER INSERT ON vinops.projects
FOR EACH ROW EXECUTE FUNCTION vinops.create_default_project_document_policy();

CREATE OR REPLACE FUNCTION vinops.publish_document_revision(
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
  SELECT revision.* INTO candidate
    FROM vinops.document_revisions AS revision
   WHERE revision.id = p_revision_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REVISION_NOT_VISIBLE' USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM 1 FROM vinops.documents AS document WHERE document.id = candidate.document_id FOR UPDATE;
  IF candidate.version <> p_expected_revision_version THEN
    RAISE EXCEPTION 'REVISION_VERSION_CONFLICT' USING ERRCODE = 'serialization_failure';
  END IF;
  IF candidate.status NOT IN ('Approved', 'Approved with Comments') THEN
    RAISE EXCEPTION 'REVISION_NOT_APPROVED' USING ERRCODE = 'check_violation';
  END IF;
  IF candidate.created_by = p_actor_user_id THEN
    RAISE EXCEPTION 'MAKER_CHECKER_VIOLATION' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT review_route.* INTO route
    FROM vinops.revision_review_routes AS review_route
   WHERE review_route.revision_id = candidate.id;
  IF NOT FOUND OR route.status <> 'Complete' THEN
    RAISE EXCEPTION 'REVIEW_ROUTE_INCOMPLETE' USING ERRCODE = 'check_violation';
  END IF;
  IF candidate.status = 'Approved with Comments' AND EXISTS (
    SELECT 1 FROM vinops.review_comments AS comment
     WHERE comment.revision_id = candidate.id AND comment.importance = 'mandatory'
       AND NOT EXISTS (
         SELECT 1 FROM vinops.review_comment_dispositions AS disposition
          WHERE disposition.comment_id = comment.id
       )
  ) THEN
    RAISE EXCEPTION 'MANDATORY_COMMENT_DISPOSITION_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT stored_file.* INTO candidate_file
    FROM vinops.document_revision_current_files AS current_file
    JOIN vinops.revision_file_versions AS file_version
      ON file_version.id = current_file.revision_file_version_id
    JOIN vinops.file_objects AS stored_file ON stored_file.id = file_version.file_id
   WHERE current_file.revision_id = candidate.id;
  IF NOT FOUND OR candidate_file.status <> 'Available' THEN
    RAISE EXCEPTION 'FILE_NOT_AVAILABLE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT current_pointer.* INTO pointer
    FROM vinops.document_current_revisions AS current_pointer
   WHERE current_pointer.document_id = candidate.document_id
     AND current_pointer.context_key = p_context_key
   FOR UPDATE;
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

  UPDATE vinops.document_revisions AS revision
     SET status = 'Published', published_at = now()
   WHERE revision.id = candidate.id
   RETURNING revision.version INTO new_revision_version;

  IF old_revision_id IS NOT NULL AND old_revision_id <> candidate.id THEN
    UPDATE vinops.document_revisions AS revision
       SET status = 'Superseded', superseded_at = now()
     WHERE revision.id = old_revision_id AND revision.status = 'Published';
  END IF;

  INSERT INTO vinops.document_current_revisions (document_id, context_key, revision_id, updated_by)
  VALUES (candidate.document_id, p_context_key, candidate.id, p_actor_user_id)
  ON CONFLICT (document_id, context_key) DO UPDATE
    SET revision_id = EXCLUDED.revision_id, updated_by = EXCLUDED.updated_by, updated_at = now()
  RETURNING version INTO new_current_version;

  SELECT COALESCE(membership.roles, ARRAY[]::text[]) INTO roles_snapshot
    FROM vinops.project_members AS membership
   WHERE membership.project_id = candidate.project_id
     AND membership.user_id = p_actor_user_id
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

REVOKE ALL ON FUNCTION vinops.create_default_project_document_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION vinops.publish_document_revision(uuid, text, bigint, bigint, uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.publish_document_revision(uuid, text, bigint, bigint, uuid, uuid, boolean) TO vinops_app;
ALTER FUNCTION vinops.create_default_project_document_policy() OWNER TO vinops_owner;
ALTER FUNCTION vinops.publish_document_revision(uuid, text, bigint, bigint, uuid, uuid, boolean) OWNER TO vinops_owner;
