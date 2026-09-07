CREATE OR REPLACE FUNCTION vinops.accept_project_invitation(
  p_token_hash char(64),
  p_user_id uuid,
  p_correlation_id uuid
)
RETURNS TABLE (membership_id uuid, project_id uuid, organization_id uuid, roles text[], version bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
DECLARE
  invitation_record vinops.invitations%ROWTYPE;
  user_email text;
  project_status text;
  membership_record vinops.project_members%ROWTYPE;
  scope_record jsonb;
BEGIN
  SELECT * INTO invitation_record
    FROM vinops.invitations
   WHERE token_hash = p_token_hash
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'no_data_found';
  END IF;
  IF invitation_record.status = 'Accepted' THEN
    IF invitation_record.accepted_by_user_id <> p_user_id THEN
      RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'no_data_found';
    END IF;
    RETURN QUERY
      SELECT membership.id, membership.project_id, membership.organization_id, membership.roles, membership.version
        FROM vinops.project_members membership
       WHERE membership.project_id = invitation_record.project_id AND membership.user_id = p_user_id;
    RETURN;
  END IF;
  IF invitation_record.status <> 'Pending' OR invitation_record.expires_at <= now() THEN
    IF invitation_record.status = 'Pending' THEN
      UPDATE vinops.invitations SET status = 'Expired' WHERE id = invitation_record.id;
    END IF;
    RAISE EXCEPTION 'INVITATION_EXPIRED' USING ERRCODE = 'check_violation';
  END IF;
  SELECT email_normalized INTO user_email FROM vinops.users WHERE id = p_user_id;
  IF NOT FOUND OR user_email <> invitation_record.email_normalized THEN
    RAISE EXCEPTION 'INVITATION_INVALID' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT status INTO project_status FROM vinops.projects WHERE id = invitation_record.project_id;
  IF project_status <> 'Active' THEN
    RAISE EXCEPTION 'PROJECT_NOT_ACTIVE' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO vinops.project_members (
    id, organization_id, project_id, user_id, roles, status, invited_by, valid_from
  ) VALUES (
    gen_random_uuid(), invitation_record.organization_id, invitation_record.project_id, p_user_id,
    invitation_record.roles, 'Active', invitation_record.created_by, now()
  )
  ON CONFLICT ON CONSTRAINT project_members_project_id_user_id_key DO NOTHING;
  SELECT * INTO membership_record
    FROM vinops.project_members AS membership
   WHERE membership.project_id = invitation_record.project_id AND membership.user_id = p_user_id;
  FOR scope_record IN SELECT value FROM jsonb_array_elements(invitation_record.scopes)
  LOOP
    INSERT INTO vinops.member_scopes (
      id, organization_id, project_id, project_member_id, scope_type, scope_id, actions
    ) VALUES (
      gen_random_uuid(), invitation_record.organization_id, invitation_record.project_id, membership_record.id,
      scope_record->>'scope_type', (scope_record->>'scope_id')::uuid,
      ARRAY(SELECT jsonb_array_elements_text(scope_record->'actions'))
    ) ON CONFLICT (project_member_id, scope_type, scope_id) DO NOTHING;
  END LOOP;
  UPDATE vinops.invitations
     SET status = 'Accepted', accepted_by_user_id = p_user_id, accepted_at = now()
   WHERE id = invitation_record.id;
  INSERT INTO vinops.audit_events (
    id, organization_id, project_id, actor_user_id, action, entity_type, entity_id, entity_version,
    outcome, correlation_id, safe_details
  ) VALUES (
    gen_random_uuid(), invitation_record.organization_id, invitation_record.project_id, p_user_id,
    'invitation.accepted', 'invitation', invitation_record.id, invitation_record.version + 1,
    'success', p_correlation_id, jsonb_build_object('membership_id', membership_record.id)
  );
  INSERT INTO vinops.outbox_events (
    id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    gen_random_uuid(), invitation_record.organization_id, invitation_record.project_id,
    'project_membership', membership_record.id, 'project_membership.activated',
    jsonb_build_object('membership_id', membership_record.id, 'project_id', invitation_record.project_id)
  );
  RETURN QUERY SELECT membership_record.id, membership_record.project_id, membership_record.organization_id,
    membership_record.roles, membership_record.version;
END;
$$;

ALTER FUNCTION vinops.accept_project_invitation(char, uuid, uuid) OWNER TO vinops_owner;
REVOKE ALL ON FUNCTION vinops.accept_project_invitation(char, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.accept_project_invitation(char, uuid, uuid) TO vinops_app;

CREATE OR REPLACE FUNCTION vinops.project_member_display_name(p_user_id uuid, p_project_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT user_record.display_name
    FROM vinops.users user_record
   WHERE user_record.id = p_user_id
     AND vinops.can_access_project(p_project_id)
     AND EXISTS (
       SELECT 1 FROM vinops.project_members membership
        WHERE membership.project_id = p_project_id AND membership.user_id = p_user_id
     );
$$;

ALTER FUNCTION vinops.project_member_display_name(uuid, uuid) OWNER TO vinops_owner;
REVOKE ALL ON FUNCTION vinops.project_member_display_name(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.project_member_display_name(uuid, uuid) TO vinops_app;
