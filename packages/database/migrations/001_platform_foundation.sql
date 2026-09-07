-- VIN-MEGA-001 / PostgreSQL-only platform foundation.
-- This migration is intentionally additive and deterministic from an empty database.
CREATE SCHEMA IF NOT EXISTS vinops;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE vinops.users (
  id uuid PRIMARY KEY,
  email_normalized text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Disabled')),
  auth_version bigint NOT NULL DEFAULT 1 CHECK (auth_version > 0),
  authorization_version bigint NOT NULL DEFAULT 1 CHECK (authorization_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (email_normalized = lower(email_normalized)),
  CHECK (length(trim(display_name)) > 0)
);

CREATE TABLE vinops.platform_entitlements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  capability text NOT NULL CHECK (capability IN ('organization_create')),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Ended')),
  valid_from timestamptz,
  valid_to timestamptz,
  granted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (user_id, capability),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE INDEX platform_entitlements_effective_idx
  ON vinops.platform_entitlements (user_id, capability, status, valid_to);

CREATE TABLE vinops.organizations (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Archived')),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CHECK (code = upper(code)),
  CHECK (length(trim(name)) > 0)
);

CREATE TABLE vinops.organization_members (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES vinops.organizations(id),
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  roles text[] NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Ended')),
  valid_from timestamptz,
  valid_to timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (organization_id, user_id),
  CHECK (cardinality(roles) > 0),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE INDEX organization_members_effective_idx
  ON vinops.organization_members (organization_id, user_id, status, valid_to);

CREATE TABLE vinops.projects (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES vinops.organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'Setup'
    CHECK (status IN ('Setup', 'Active', 'Suspended', 'Archiving', 'Archived')),
  archive_plan_reference text,
  retention_plan_reference text,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  suspended_at timestamptz,
  archived_at timestamptz,
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id),
  CHECK (code = upper(code)),
  CHECK (length(trim(name)) > 0),
  CHECK (length(trim(timezone)) > 0)
);
CREATE INDEX projects_organization_status_idx ON vinops.projects (organization_id, status, id);

CREATE TABLE vinops.project_members (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  roles text[] NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended', 'Ended')),
  valid_from timestamptz,
  valid_to timestamptz,
  invited_by uuid REFERENCES vinops.users(id),
  ended_reason text,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, user_id),
  CHECK (cardinality(roles) > 0),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE INDEX project_members_effective_idx
  ON vinops.project_members (project_id, user_id, status, valid_to);

CREATE TABLE vinops.member_scopes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  project_member_id uuid NOT NULL REFERENCES vinops.project_members(id),
  scope_type text NOT NULL CHECK (scope_type IN ('project', 'location', 'work', 'discipline', 'classification')),
  scope_id uuid NOT NULL,
  actions text[] NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_member_id, scope_type, scope_id),
  CHECK (cardinality(actions) > 0),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE INDEX member_scopes_lookup_idx
  ON vinops.member_scopes (project_member_id, scope_type, scope_id) WHERE revoked_at IS NULL;

CREATE TABLE vinops.invitations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  email_normalized text NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  roles text[] NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Expired', 'Revoked')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  accepted_by_user_id uuid REFERENCES vinops.users(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (email_normalized = lower(email_normalized)),
  CHECK (cardinality(roles) > 0),
  CHECK (expires_at > created_at),
  CHECK ((status <> 'Accepted') OR (accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE INDEX invitations_project_status_idx ON vinops.invitations (project_id, status, expires_at);

CREATE TABLE vinops.partner_organizations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
  contact_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (code = upper(code))
);

CREATE TABLE vinops.project_calendars (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  timezone text NOT NULL,
  working_days smallint[] NOT NULL,
  holidays jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, name),
  CHECK (length(trim(timezone)) > 0),
  CHECK (cardinality(working_days) BETWEEN 1 AND 7),
  CHECK (working_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[])
);

CREATE TABLE vinops.numbering_profiles (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  template text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (code = upper(code)),
  CHECK (length(trim(template)) > 0)
);

CREATE TABLE vinops.numbering_counters (
  id uuid PRIMARY KEY,
  numbering_profile_id uuid NOT NULL REFERENCES vinops.numbering_profiles(id),
  counter_key text NOT NULL,
  current_value bigint NOT NULL DEFAULT 0 CHECK (current_value >= 0),
  issued_at timestamptz,
  UNIQUE (numbering_profile_id, counter_key)
);

CREATE TABLE vinops.location_nodes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  parent_id uuid REFERENCES vinops.location_nodes(id),
  code text NOT NULL,
  name text NOT NULL,
  node_type text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(code)) > 0),
  CHECK (length(trim(name)) > 0)
);
CREATE UNIQUE INDEX location_nodes_active_sibling_code_idx
  ON vinops.location_nodes (project_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), code)
  WHERE archived_at IS NULL;
CREATE INDEX location_nodes_tree_idx ON vinops.location_nodes (project_id, parent_id, sort_order, id);

CREATE TABLE vinops.work_nodes (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  parent_id uuid REFERENCES vinops.work_nodes(id),
  location_node_id uuid REFERENCES vinops.location_nodes(id),
  owner_partner_organization_id uuid REFERENCES vinops.partner_organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  node_type text NOT NULL CHECK (node_type IN ('work_package', 'discipline', 'system', 'trade', 'other')),
  planned_start_at timestamptz,
  planned_finish_at timestamptz,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(code)) > 0),
  CHECK (length(trim(name)) > 0),
  CHECK (planned_finish_at IS NULL OR planned_start_at IS NULL OR planned_finish_at >= planned_start_at)
);
CREATE UNIQUE INDEX work_nodes_active_sibling_code_idx
  ON vinops.work_nodes (project_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), code)
  WHERE archived_at IS NULL;
CREATE INDEX work_nodes_tree_idx ON vinops.work_nodes (project_id, parent_id, id);

CREATE TABLE vinops.location_work_links (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  location_node_id uuid NOT NULL REFERENCES vinops.location_nodes(id),
  work_node_id uuid NOT NULL REFERENCES vinops.work_nodes(id),
  is_primary boolean NOT NULL DEFAULT false,
  linked_by uuid NOT NULL REFERENCES vinops.users(id),
  linked_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (location_node_id, work_node_id)
);

CREATE TABLE vinops.disciplines (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (code = upper(code))
);

CREATE TABLE vinops.document_classifications (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  parent_id uuid REFERENCES vinops.document_classifications(id),
  classification_type text NOT NULL CHECK (
    classification_type IN ('document_type', 'document_subtype', 'originator', 'package', 'confidentiality', 'review', 'distribution')
  ),
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, classification_type, code),
  CHECK (code = upper(code))
);

CREATE TABLE vinops.refresh_token_families (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Revoked', 'Expired')),
  auth_version bigint NOT NULL CHECK (auth_version > 0),
  authorization_version bigint NOT NULL CHECK (authorization_version > 0),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  reuse_detected_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_rotated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (absolute_expires_at > created_at),
  CHECK (idle_expires_at <= absolute_expires_at)
);
CREATE INDEX refresh_token_families_user_idx ON vinops.refresh_token_families (user_id, status);

CREATE TABLE vinops.auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  family_id uuid NOT NULL REFERENCES vinops.refresh_token_families(id),
  device_name text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Revoked', 'Expired')),
  auth_version bigint NOT NULL CHECK (auth_version > 0),
  authorization_version bigint NOT NULL CHECK (authorization_version > 0),
  csrf_secret_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (id, family_id)
);
CREATE INDEX auth_sessions_user_idx ON vinops.auth_sessions (user_id, status, created_at DESC);

CREATE TABLE vinops.refresh_token_credentials (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  family_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  parent_credential_id uuid REFERENCES vinops.refresh_token_credentials(id),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (session_id, family_id) REFERENCES vinops.auth_sessions (id, family_id),
  CHECK (expires_at > issued_at)
);
CREATE INDEX refresh_token_credentials_family_idx ON vinops.refresh_token_credentials (family_id, consumed_at, expires_at);

CREATE TABLE vinops.password_reset_credentials (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  requested_ip_hash char(64),
  CHECK (expires_at > requested_at)
);
CREATE INDEX password_reset_credentials_user_idx ON vinops.password_reset_credentials (user_id, expires_at);

CREATE TABLE vinops.delegations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  delegator_user_id uuid NOT NULL REFERENCES vinops.users(id),
  delegatee_user_id uuid NOT NULL REFERENCES vinops.users(id),
  scope_type text NOT NULL CHECK (scope_type IN ('project', 'location', 'work', 'discipline', 'classification')),
  scope_id uuid NOT NULL,
  actions text[] NOT NULL,
  reason text NOT NULL,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Revoked', 'Expired')),
  revoked_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (delegator_user_id <> delegatee_user_id),
  CHECK (cardinality(actions) > 0),
  CHECK (valid_to > valid_from),
  CHECK (length(trim(reason)) > 0)
);

CREATE TABLE vinops.break_glass_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  requester_user_id uuid NOT NULL REFERENCES vinops.users(id),
  approver_user_id uuid REFERENCES vinops.users(id),
  reason text NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('project', 'location', 'work', 'discipline', 'classification')),
  scope_id uuid NOT NULL,
  actions text[] NOT NULL,
  status text NOT NULL DEFAULT 'Requested' CHECK (status IN ('Requested', 'Approved', 'Rejected', 'Expired', 'Revoked')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  valid_from timestamptz,
  valid_to timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (cardinality(actions) > 0),
  CHECK (length(trim(reason)) > 0),
  CHECK (
    status <> 'Approved' OR (
      approver_user_id IS NOT NULL AND approved_at IS NOT NULL AND valid_from IS NOT NULL AND valid_to IS NOT NULL
      AND valid_to > valid_from AND valid_to <= valid_from + interval '4 hours'
    )
  )
);

CREATE TABLE vinops.break_glass_sessions (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES vinops.break_glass_requests(id),
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Ended', 'Expired', 'Revoked')),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  banner_acknowledged_at timestamptz,
  CHECK (expires_at > started_at)
);

CREATE TABLE vinops.idempotency_keys (
  id uuid PRIMARY KEY,
  organization_id uuid,
  project_id uuid,
  actor_user_id uuid NOT NULL REFERENCES vinops.users(id),
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'InProgress' CHECK (status IN ('InProgress', 'Completed', 'Failed')),
  response_code integer,
  response_body jsonb,
  entity_id uuid,
  entity_version bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (actor_user_id, operation, idempotency_key),
  CHECK (length(trim(idempotency_key)) BETWEEN 8 AND 255),
  CHECK (payload_hash ~ '^[a-f0-9]{64}$')
);

CREATE TABLE vinops.entity_transitions (
  id uuid PRIMARY KEY,
  organization_id uuid,
  project_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  expected_version bigint NOT NULL CHECK (expected_version > 0),
  resulting_version bigint NOT NULL CHECK (resulting_version > expected_version),
  actor_user_id uuid NOT NULL REFERENCES vinops.users(id),
  reason text,
  idempotency_key_id uuid REFERENCES vinops.idempotency_keys(id),
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((project_id IS NULL) OR (organization_id IS NOT NULL))
);
CREATE INDEX entity_transitions_entity_idx ON vinops.entity_transitions (entity_type, entity_id, occurred_at DESC);

CREATE TABLE vinops.audit_events (
  id uuid PRIMARY KEY,
  organization_id uuid,
  project_id uuid,
  actor_user_id uuid REFERENCES vinops.users(id),
  effective_roles text[] NOT NULL DEFAULT '{}',
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_version bigint,
  outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failed')),
  reason_code text,
  safe_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((project_id IS NULL) OR (organization_id IS NOT NULL))
);
CREATE INDEX audit_events_project_timeline_idx ON vinops.audit_events (project_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_actor_timeline_idx ON vinops.audit_events (actor_user_id, occurred_at DESC, id DESC);

CREATE TABLE vinops.outbox_events (
  id uuid PRIMARY KEY,
  organization_id uuid,
  project_id uuid,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Claimed', 'Published', 'Failed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  publish_attempts integer NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
  published_at timestamptz,
  idempotency_key_id uuid REFERENCES vinops.idempotency_keys(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key_id, event_type),
  CHECK ((project_id IS NULL) OR (organization_id IS NOT NULL))
);
CREATE INDEX outbox_events_claim_idx ON vinops.outbox_events (status, available_at, created_at);

CREATE TABLE vinops.context_imports (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('location_nodes', 'work_nodes')),
  idempotency_key text NOT NULL,
  payload_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'Previewed' CHECK (status IN ('Previewed', 'Committed', 'Failed')),
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, target_type, idempotency_key),
  CHECK (payload_hash ~ '^[a-f0-9]{64}$')
);

CREATE FUNCTION vinops.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE FUNCTION vinops.increment_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE FUNCTION vinops.prevent_project_tenant_move() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'PROJECT_TENANT_IMMUTABLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION vinops.prevent_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HARD_DELETE_FORBIDDEN: archive or revoke historical records instead' USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE FUNCTION vinops.assert_location_tree_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ancestor_id uuid;
  parent_project_id uuid;
  parent_organization_id uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT project_id, organization_id INTO parent_project_id, parent_organization_id
    FROM vinops.location_nodes WHERE id = NEW.parent_id;
  IF NOT FOUND OR parent_project_id <> NEW.project_id OR parent_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'LOCATION_PARENT_OUT_OF_SCOPE' USING ERRCODE = 'foreign_key_violation';
  END IF;
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id FROM vinops.location_nodes WHERE id = NEW.parent_id
    UNION ALL
    SELECT candidate.id, candidate.parent_id
      FROM vinops.location_nodes candidate
      JOIN ancestors ON candidate.id = ancestors.parent_id
  )
  SELECT id INTO ancestor_id FROM ancestors WHERE id = NEW.id LIMIT 1;
  IF ancestor_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOCATION_TREE_CYCLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION vinops.assert_work_tree_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ancestor_id uuid;
  parent_project_id uuid;
  parent_organization_id uuid;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT project_id, organization_id INTO parent_project_id, parent_organization_id
    FROM vinops.work_nodes WHERE id = NEW.parent_id;
  IF NOT FOUND OR parent_project_id <> NEW.project_id OR parent_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'WORK_PARENT_OUT_OF_SCOPE' USING ERRCODE = 'foreign_key_violation';
  END IF;
  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id FROM vinops.work_nodes WHERE id = NEW.parent_id
    UNION ALL
    SELECT candidate.id, candidate.parent_id
      FROM vinops.work_nodes candidate
      JOIN ancestors ON candidate.id = ancestors.parent_id
  )
  SELECT id INTO ancestor_id FROM ancestors WHERE id = NEW.id LIMIT 1;
  IF ancestor_id IS NOT NULL THEN
    RAISE EXCEPTION 'WORK_TREE_CYCLE' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_no_tenant_move BEFORE UPDATE ON vinops.projects
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_project_tenant_move();
CREATE TRIGGER location_nodes_tree_guard BEFORE INSERT OR UPDATE OF parent_id, project_id, organization_id ON vinops.location_nodes
  FOR EACH ROW EXECUTE FUNCTION vinops.assert_location_tree_integrity();
CREATE TRIGGER work_nodes_tree_guard BEFORE INSERT OR UPDATE OF parent_id, project_id, organization_id ON vinops.work_nodes
  FOR EACH ROW EXECUTE FUNCTION vinops.assert_work_tree_integrity();

CREATE TRIGGER organizations_touch BEFORE UPDATE ON vinops.organizations FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER organization_members_touch BEFORE UPDATE ON vinops.organization_members FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER projects_touch BEFORE UPDATE ON vinops.projects FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER project_members_touch BEFORE UPDATE ON vinops.project_members FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER invitations_touch BEFORE UPDATE ON vinops.invitations FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER partner_organizations_touch BEFORE UPDATE ON vinops.partner_organizations FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER project_calendars_touch BEFORE UPDATE ON vinops.project_calendars FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER numbering_profiles_touch BEFORE UPDATE ON vinops.numbering_profiles FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER location_nodes_touch BEFORE UPDATE ON vinops.location_nodes FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER work_nodes_touch BEFORE UPDATE ON vinops.work_nodes FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER disciplines_touch BEFORE UPDATE ON vinops.disciplines FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER classifications_touch BEFORE UPDATE ON vinops.document_classifications FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER delegations_touch BEFORE UPDATE ON vinops.delegations FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER break_glass_requests_touch BEFORE UPDATE ON vinops.break_glass_requests FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER organizations_version BEFORE UPDATE ON vinops.organizations FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER organization_members_version BEFORE UPDATE ON vinops.organization_members FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER projects_version BEFORE UPDATE ON vinops.projects FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER project_members_version BEFORE UPDATE ON vinops.project_members FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER invitations_version BEFORE UPDATE ON vinops.invitations FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER partner_organizations_version BEFORE UPDATE ON vinops.partner_organizations FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER project_calendars_version BEFORE UPDATE ON vinops.project_calendars FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER numbering_profiles_version BEFORE UPDATE ON vinops.numbering_profiles FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER location_nodes_version BEFORE UPDATE ON vinops.location_nodes FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER work_nodes_version BEFORE UPDATE ON vinops.work_nodes FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER disciplines_version BEFORE UPDATE ON vinops.disciplines FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER classifications_version BEFORE UPDATE ON vinops.document_classifications FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER delegations_version BEFORE UPDATE ON vinops.delegations FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER break_glass_requests_version BEFORE UPDATE ON vinops.break_glass_requests FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

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
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON vinops.%I FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete()',
      target_table || '_no_delete', target_table);
  END LOOP;
END;
$$;
