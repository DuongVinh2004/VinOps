-- VIN-MEGA-001 / least-privilege runtime roles and defense-in-depth RLS.
-- Migrations must be executed by a database administration principal, never vinops_app.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinops_owner') THEN
    CREATE ROLE vinops_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinops_app') THEN
    CREATE ROLE vinops_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinops_worker') THEN
    CREATE ROLE vinops_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
  END IF;
END;
$$;

REVOKE ALL ON SCHEMA vinops FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA vinops FROM PUBLIC;
GRANT USAGE ON SCHEMA vinops TO vinops_app, vinops_worker;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA vinops TO vinops_app;
REVOKE DELETE ON ALL TABLES IN SCHEMA vinops FROM vinops_app;

CREATE FUNCTION vinops.current_actor_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE FUNCTION vinops.current_correlation_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.correlation_id', true), '')::uuid;
$$;

CREATE FUNCTION vinops.set_request_context(p_user_id uuid, p_correlation_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
BEGIN
  IF p_user_id IS NULL OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'REQUEST_CONTEXT_REQUIRED' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM set_config('app.user_id', p_user_id::text, true);
  PERFORM set_config('app.correlation_id', p_correlation_id::text, true);
END;
$$;

CREATE FUNCTION vinops.is_active_organization_member(p_organization_id uuid, p_user_id uuid DEFAULT vinops.current_actor_id())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM vinops.organization_members membership
      JOIN vinops.organizations organization ON organization.id = membership.organization_id
     WHERE membership.organization_id = p_organization_id
       AND membership.user_id = p_user_id
       AND membership.status = 'Active'
       AND (membership.valid_from IS NULL OR membership.valid_from <= now())
       AND (membership.valid_to IS NULL OR membership.valid_to > now())
       AND organization.status = 'Active'
  );
$$;

CREATE FUNCTION vinops.has_organization_role(p_organization_id uuid, p_role text, p_user_id uuid DEFAULT vinops.current_actor_id())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM vinops.organization_members membership
     WHERE membership.organization_id = p_organization_id
       AND membership.user_id = p_user_id
       AND membership.status = 'Active'
       AND (membership.valid_from IS NULL OR membership.valid_from <= now())
       AND (membership.valid_to IS NULL OR membership.valid_to > now())
       AND p_role = ANY(membership.roles)
  );
$$;

CREATE FUNCTION vinops.has_platform_entitlement(p_capability text, p_user_id uuid DEFAULT vinops.current_actor_id())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM vinops.platform_entitlements entitlement
     WHERE entitlement.user_id = p_user_id
       AND entitlement.capability = p_capability
       AND entitlement.status = 'Active'
       AND (entitlement.valid_from IS NULL OR entitlement.valid_from <= now())
       AND (entitlement.valid_to IS NULL OR entitlement.valid_to > now())
  );
$$;

CREATE FUNCTION vinops.is_active_project_member(p_project_id uuid, p_user_id uuid DEFAULT vinops.current_actor_id())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM vinops.project_members membership
      JOIN vinops.projects project ON project.id = membership.project_id
     WHERE membership.project_id = p_project_id
       AND membership.user_id = p_user_id
       AND membership.status = 'Active'
       AND (membership.valid_from IS NULL OR membership.valid_from <= now())
       AND (membership.valid_to IS NULL OR membership.valid_to > now())
       AND project.status IN ('Setup', 'Active', 'Suspended', 'Archiving', 'Archived')
  );
$$;

CREATE FUNCTION vinops.can_access_project(p_project_id uuid, p_user_id uuid DEFAULT vinops.current_actor_id())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM vinops.projects project
     WHERE project.id = p_project_id
       AND (
         vinops.is_active_project_member(project.id, p_user_id)
         OR vinops.has_organization_role(project.organization_id, 'organization_owner', p_user_id)
         OR vinops.has_organization_role(project.organization_id, 'security_admin', p_user_id)
       )
  );
$$;

CREATE FUNCTION vinops.can_manage_project_context(p_project_id uuid, p_user_id uuid DEFAULT vinops.current_actor_id())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM vinops.projects project
     WHERE project.id = p_project_id
       AND (
         vinops.has_organization_role(project.organization_id, 'organization_owner', p_user_id)
         OR vinops.has_organization_role(project.organization_id, 'security_admin', p_user_id)
         OR EXISTS (
           SELECT 1
             FROM vinops.project_members membership
            WHERE membership.project_id = project.id
              AND membership.user_id = p_user_id
              AND membership.status = 'Active'
              AND (membership.valid_from IS NULL OR membership.valid_from <= now())
              AND (membership.valid_to IS NULL OR membership.valid_to > now())
              AND membership.roles && ARRAY['project_admin', 'project_context_manager']::text[]
         )
       )
  );
$$;

CREATE FUNCTION vinops.can_read_scoped_resource(
  p_project_id uuid,
  p_scope_type text,
  p_scope_id uuid,
  p_action text DEFAULT 'read',
  p_user_id uuid DEFAULT vinops.current_actor_id()
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT
    vinops.can_manage_project_context(p_project_id, p_user_id)
    OR EXISTS (
      SELECT 1
        FROM vinops.member_scopes scope
        JOIN vinops.project_members membership ON membership.id = scope.project_member_id
       WHERE scope.project_id = p_project_id
         AND membership.project_id = p_project_id
         AND membership.user_id = p_user_id
         AND membership.status = 'Active'
         AND (membership.valid_from IS NULL OR membership.valid_from <= now())
         AND (membership.valid_to IS NULL OR membership.valid_to > now())
         AND scope.revoked_at IS NULL
         AND (scope.valid_from IS NULL OR scope.valid_from <= now())
         AND (scope.valid_to IS NULL OR scope.valid_to > now())
         AND p_action = ANY(scope.actions)
         AND (
           scope.scope_type = 'project'
           OR (scope.scope_type = p_scope_type AND scope.scope_id = p_scope_id)
         )
    );
$$;

CREATE FUNCTION vinops.can_access_organization(p_organization_id uuid, p_user_id uuid DEFAULT vinops.current_actor_id())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT vinops.is_active_organization_member(p_organization_id, p_user_id);
$$;

CREATE FUNCTION vinops.lookup_user_for_login(p_email_normalized text)
RETURNS TABLE (
  id uuid,
  password_hash text,
  status text,
  auth_version bigint,
  authorization_version bigint,
  display_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT user_record.id, user_record.password_hash, user_record.status, user_record.auth_version,
         user_record.authorization_version, user_record.display_name
    FROM vinops.users user_record
   WHERE user_record.email_normalized = lower(trim(p_email_normalized))
     AND user_record.archived_at IS NULL;
$$;

CREATE FUNCTION vinops.lookup_user_for_password_reset(p_email_normalized text)
RETURNS TABLE (id uuid, email_normalized text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT user_record.id, user_record.email_normalized, user_record.status
    FROM vinops.users user_record
   WHERE user_record.email_normalized = lower(trim(p_email_normalized))
     AND user_record.archived_at IS NULL;
$$;

CREATE FUNCTION vinops.lookup_refresh_credential(p_token_hash char(64))
RETURNS TABLE (
  credential_id uuid,
  session_id uuid,
  family_id uuid,
  user_id uuid,
  credential_expires_at timestamptz,
  credential_consumed_at timestamptz,
  credential_revoked_at timestamptz,
  session_status text,
  family_status text,
  family_idle_expires_at timestamptz,
  family_absolute_expires_at timestamptz,
  csrf_secret_hash char(64),
  auth_version bigint,
  authorization_version bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT credential.id, session.id, family.id, session.user_id, credential.expires_at,
         credential.consumed_at, credential.revoked_at, session.status, family.status,
         family.idle_expires_at, family.absolute_expires_at, session.csrf_secret_hash,
         session.auth_version, session.authorization_version
    FROM vinops.refresh_token_credentials credential
    JOIN vinops.auth_sessions session ON session.id = credential.session_id
    JOIN vinops.refresh_token_families family ON family.id = credential.family_id
   WHERE credential.token_hash = p_token_hash;
$$;

CREATE FUNCTION vinops.lookup_password_reset_credential(p_token_hash char(64))
RETURNS TABLE (credential_id uuid, user_id uuid, expires_at timestamptz, used_at timestamptz, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT credential.id, credential.user_id, credential.expires_at, credential.used_at, user_record.status
    FROM vinops.password_reset_credentials credential
    JOIN vinops.users user_record ON user_record.id = credential.user_id
   WHERE credential.token_hash = p_token_hash;
$$;

CREATE FUNCTION vinops.accept_project_invitation(
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
  ON CONFLICT (project_id, user_id) DO NOTHING;
  SELECT * INTO membership_record
    FROM vinops.project_members
   WHERE project_id = invitation_record.project_id AND user_id = p_user_id;
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

CREATE FUNCTION vinops.claim_outbox_events(p_worker_name text, p_limit integer)
RETURNS SETOF vinops.outbox_events
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
BEGIN
  -- Invocation is restricted by explicit EXECUTE grants. SECURITY DEFINER
  -- changes current_user to vinops_owner, so role checks here would be wrong.
  RETURN QUERY
  WITH candidates AS (
    SELECT id
      FROM vinops.outbox_events
     WHERE status IN ('Pending', 'Failed')
       AND available_at <= now()
     ORDER BY available_at, created_at, id
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(p_limit, 100))
  )
  UPDATE vinops.outbox_events event
     SET status = 'Claimed', claimed_at = now(), claimed_by = p_worker_name,
         publish_attempts = event.publish_attempts + 1
    FROM candidates
   WHERE event.id = candidates.id
  RETURNING event.*;
END;
$$;

CREATE FUNCTION vinops.mark_outbox_published(p_event_id uuid, p_worker_name text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
BEGIN
  -- Explicit EXECUTE grants are the worker capability boundary.
  UPDATE vinops.outbox_events
     SET status = 'Published', published_at = now()
   WHERE id = p_event_id AND status = 'Claimed' AND claimed_by = p_worker_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OUTBOX_CLAIM_NOT_OWNED' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

CREATE FUNCTION vinops.mark_outbox_failed(p_event_id uuid, p_worker_name text, p_retry_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
BEGIN
  -- Explicit EXECUTE grants are the worker capability boundary.
  UPDATE vinops.outbox_events
     SET status = CASE WHEN p_retry_at IS NULL THEN 'Failed' ELSE 'Pending' END,
         available_at = COALESCE(p_retry_at, available_at), claimed_at = NULL, claimed_by = NULL
   WHERE id = p_event_id AND status = 'Claimed' AND claimed_by = p_worker_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OUTBOX_CLAIM_NOT_OWNED' USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA vinops FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vinops.current_actor_id() TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.can_access_organization(uuid, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.set_request_context(uuid, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.lookup_user_for_login(text) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.lookup_user_for_password_reset(text) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.lookup_refresh_credential(char) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.lookup_password_reset_credential(char) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.accept_project_invitation(char, uuid, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.claim_outbox_events(text, integer) TO vinops_worker;
GRANT EXECUTE ON FUNCTION vinops.mark_outbox_published(uuid, text) TO vinops_worker;
GRANT EXECUTE ON FUNCTION vinops.mark_outbox_failed(uuid, text, timestamptz) TO vinops_worker;
GRANT EXECUTE ON FUNCTION vinops.is_active_organization_member(uuid, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.is_active_project_member(uuid, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.can_access_project(uuid, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.can_manage_project_context(uuid, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.can_read_scoped_resource(uuid, text, uuid, text, uuid) TO vinops_app;
GRANT EXECUTE ON FUNCTION vinops.has_platform_entitlement(text, uuid) TO vinops_app;

DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'users', 'platform_entitlements', 'organizations', 'organization_members', 'projects', 'project_members', 'member_scopes', 'invitations',
    'partner_organizations', 'project_calendars', 'numbering_profiles', 'numbering_counters', 'location_nodes', 'work_nodes',
    'location_work_links', 'disciplines', 'document_classifications', 'refresh_token_families', 'auth_sessions',
    'refresh_token_credentials', 'password_reset_credentials', 'delegations', 'break_glass_requests', 'break_glass_sessions',
    'idempotency_keys', 'entity_transitions', 'audit_events', 'outbox_events', 'context_imports'
  ] LOOP
    EXECUTE format('ALTER TABLE vinops.%I ENABLE ROW LEVEL SECURITY', target_table);
  END LOOP;
END;
$$;

CREATE POLICY users_self ON vinops.users
  USING (id = vinops.current_actor_id())
  WITH CHECK (id = vinops.current_actor_id());

CREATE POLICY platform_entitlements_self ON vinops.platform_entitlements
  USING (user_id = vinops.current_actor_id())
  WITH CHECK (false);

CREATE POLICY organizations_visible ON vinops.organizations
  USING (vinops.can_access_organization(id) OR created_by = vinops.current_actor_id())
  WITH CHECK (
    created_by = vinops.current_actor_id()
    AND vinops.has_platform_entitlement('organization_create')
  );

CREATE POLICY organization_members_visible ON vinops.organization_members
  USING (user_id = vinops.current_actor_id() OR vinops.can_access_organization(organization_id))
  WITH CHECK (
    vinops.can_access_organization(organization_id)
    OR (
      user_id = vinops.current_actor_id()
      AND 'organization_owner' = ANY(roles)
    )
  );

CREATE POLICY projects_visible ON vinops.projects
  USING (vinops.can_access_project(id) OR vinops.can_access_organization(organization_id))
  WITH CHECK (vinops.can_access_organization(organization_id));

CREATE POLICY project_members_visible ON vinops.project_members
  USING (user_id = vinops.current_actor_id() OR vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY member_scopes_visible ON vinops.member_scopes
  USING (
    vinops.can_manage_project_context(project_id)
    OR EXISTS (
      SELECT 1 FROM vinops.project_members membership
       WHERE membership.id = project_member_id AND membership.user_id = vinops.current_actor_id()
    )
  )
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY invitations_visible ON vinops.invitations
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY partner_organizations_visible ON vinops.partner_organizations
  USING (vinops.can_read_scoped_resource(project_id, 'project', project_id))
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY project_calendars_visible ON vinops.project_calendars
  USING (vinops.can_read_scoped_resource(project_id, 'project', project_id))
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY numbering_profiles_visible ON vinops.numbering_profiles
  USING (vinops.can_read_scoped_resource(project_id, 'project', project_id))
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY numbering_counters_visible ON vinops.numbering_counters
  USING (EXISTS (
    SELECT 1 FROM vinops.numbering_profiles profile
     WHERE profile.id = numbering_profile_id
       AND vinops.can_read_scoped_resource(profile.project_id, 'project', profile.project_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM vinops.numbering_profiles profile
     WHERE profile.id = numbering_profile_id
       AND vinops.can_manage_project_context(profile.project_id)
  ));

CREATE POLICY location_nodes_visible ON vinops.location_nodes
  USING (vinops.can_read_scoped_resource(project_id, 'location', id))
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY work_nodes_visible ON vinops.work_nodes
  USING (vinops.can_read_scoped_resource(project_id, 'work', id))
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY location_work_links_visible ON vinops.location_work_links
  USING (
    vinops.can_read_scoped_resource(project_id, 'location', location_node_id)
    AND vinops.can_read_scoped_resource(project_id, 'work', work_node_id)
  )
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY disciplines_visible ON vinops.disciplines
  USING (vinops.can_read_scoped_resource(project_id, 'discipline', id))
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY classifications_visible ON vinops.document_classifications
  USING (vinops.can_read_scoped_resource(project_id, 'classification', id))
  WITH CHECK (vinops.can_manage_project_context(project_id));

CREATE POLICY refresh_families_self ON vinops.refresh_token_families
  USING (user_id = vinops.current_actor_id())
  WITH CHECK (user_id = vinops.current_actor_id());

CREATE POLICY sessions_self ON vinops.auth_sessions
  USING (user_id = vinops.current_actor_id())
  WITH CHECK (user_id = vinops.current_actor_id());

CREATE POLICY refresh_credentials_self ON vinops.refresh_token_credentials
  USING (EXISTS (
    SELECT 1 FROM vinops.auth_sessions session WHERE session.id = session_id AND session.user_id = vinops.current_actor_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM vinops.auth_sessions session WHERE session.id = session_id AND session.user_id = vinops.current_actor_id()
  ));

CREATE POLICY password_reset_self ON vinops.password_reset_credentials
  USING (user_id = vinops.current_actor_id())
  WITH CHECK (user_id = vinops.current_actor_id());

CREATE POLICY delegations_visible ON vinops.delegations
  USING (
    delegator_user_id = vinops.current_actor_id()
    OR delegatee_user_id = vinops.current_actor_id()
    OR vinops.can_access_project(project_id)
  )
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY break_glass_requests_visible ON vinops.break_glass_requests
  USING (
    requester_user_id = vinops.current_actor_id()
    OR approver_user_id = vinops.current_actor_id()
    OR vinops.can_access_project(project_id)
  )
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY break_glass_sessions_visible ON vinops.break_glass_sessions
  USING (user_id = vinops.current_actor_id())
  WITH CHECK (user_id = vinops.current_actor_id());

CREATE POLICY idempotency_keys_self ON vinops.idempotency_keys
  USING (actor_user_id = vinops.current_actor_id())
  WITH CHECK (actor_user_id = vinops.current_actor_id());

CREATE POLICY entity_transitions_visible ON vinops.entity_transitions
  USING (
    actor_user_id = vinops.current_actor_id()
    OR (project_id IS NOT NULL AND vinops.can_access_project(project_id))
    OR (project_id IS NULL AND organization_id IS NOT NULL AND vinops.can_access_organization(organization_id))
  )
  WITH CHECK (actor_user_id = vinops.current_actor_id());

CREATE POLICY audit_events_visible ON vinops.audit_events
  USING (
    actor_user_id = vinops.current_actor_id()
    OR (project_id IS NOT NULL AND vinops.can_access_project(project_id))
    OR (project_id IS NULL AND organization_id IS NOT NULL AND vinops.can_access_organization(organization_id))
  )
  WITH CHECK (actor_user_id = vinops.current_actor_id());

CREATE POLICY outbox_events_worker_or_project ON vinops.outbox_events
  USING (
    current_user = 'vinops_worker'
    OR (project_id IS NOT NULL AND vinops.can_access_project(project_id))
    OR (project_id IS NULL AND organization_id IS NOT NULL AND vinops.can_access_organization(organization_id))
  )
  WITH CHECK (
    (project_id IS NOT NULL AND vinops.can_access_project(project_id))
    OR (project_id IS NULL AND organization_id IS NOT NULL AND vinops.can_access_organization(organization_id))
    OR (project_id IS NULL AND organization_id IS NULL)
  );

CREATE POLICY context_imports_visible ON vinops.context_imports
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

ALTER FUNCTION vinops.set_request_context(uuid, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.is_active_organization_member(uuid, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.has_organization_role(uuid, text, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.has_platform_entitlement(text, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.is_active_project_member(uuid, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.can_access_project(uuid, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.can_manage_project_context(uuid, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.can_read_scoped_resource(uuid, text, uuid, text, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.can_access_organization(uuid, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.lookup_user_for_login(text) OWNER TO vinops_owner;
ALTER FUNCTION vinops.lookup_user_for_password_reset(text) OWNER TO vinops_owner;
ALTER FUNCTION vinops.lookup_refresh_credential(char) OWNER TO vinops_owner;
ALTER FUNCTION vinops.lookup_password_reset_credential(char) OWNER TO vinops_owner;
ALTER FUNCTION vinops.accept_project_invitation(char, uuid, uuid) OWNER TO vinops_owner;
ALTER FUNCTION vinops.claim_outbox_events(text, integer) OWNER TO vinops_owner;
ALTER FUNCTION vinops.mark_outbox_published(uuid, text) OWNER TO vinops_owner;
ALTER FUNCTION vinops.mark_outbox_failed(uuid, text, timestamptz) OWNER TO vinops_owner;

ALTER SCHEMA vinops OWNER TO vinops_owner;
DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'users', 'platform_entitlements', 'organizations', 'organization_members', 'projects', 'project_members', 'member_scopes', 'invitations',
    'partner_organizations', 'project_calendars', 'numbering_profiles', 'numbering_counters', 'location_nodes', 'work_nodes',
    'location_work_links', 'disciplines', 'document_classifications', 'refresh_token_families', 'auth_sessions',
    'refresh_token_credentials', 'password_reset_credentials', 'delegations', 'break_glass_requests', 'break_glass_sessions',
    'idempotency_keys', 'entity_transitions', 'audit_events', 'outbox_events', 'context_imports'
  ] LOOP
    EXECUTE format('ALTER TABLE vinops.%I OWNER TO vinops_owner', target_table);
  END LOOP;
END;
$$;
