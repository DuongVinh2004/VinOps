CREATE OR REPLACE FUNCTION vinops.project_member_display_name(p_user_id uuid, p_project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT user_record.display_name
    FROM vinops.users user_record
   WHERE user_record.id = p_user_id
     AND vinops.can_access_project(
       p_project_id,
       NULLIF(current_setting('app.user_id', true), '')::uuid
     )
     AND EXISTS (
       SELECT 1 FROM vinops.project_members membership
        WHERE membership.project_id = p_project_id AND membership.user_id = p_user_id
     );
$$;

ALTER FUNCTION vinops.project_member_display_name(uuid, uuid) OWNER TO vinops_owner;
REVOKE ALL ON FUNCTION vinops.project_member_display_name(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.project_member_display_name(uuid, uuid) TO vinops_app;

CREATE OR REPLACE FUNCTION vinops.revoke_project_member_sessions(
  p_user_id uuid,
  p_project_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
DECLARE
  actor_id uuid := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF actor_id IS NULL OR NOT vinops.can_manage_project_context(p_project_id, actor_id) THEN
    RAISE EXCEPTION 'RESOURCE_SCOPE_DENIED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vinops.project_members membership
     WHERE membership.project_id = p_project_id AND membership.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'RESOURCE_NOT_VISIBLE' USING ERRCODE = 'no_data_found';
  END IF;
  UPDATE vinops.users
     SET authorization_version = authorization_version + 1
   WHERE id = p_user_id;
  UPDATE vinops.auth_sessions
     SET status = 'Revoked', revoked_at = now()
   WHERE user_id = p_user_id AND status = 'Active';
  UPDATE vinops.refresh_token_families
     SET status = 'Revoked', revoked_at = now()
   WHERE user_id = p_user_id AND status = 'Active';
END;
$$;

ALTER FUNCTION vinops.revoke_project_member_sessions(uuid, uuid) OWNER TO vinops_owner;
REVOKE ALL ON FUNCTION vinops.revoke_project_member_sessions(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.revoke_project_member_sessions(uuid, uuid) TO vinops_app;
