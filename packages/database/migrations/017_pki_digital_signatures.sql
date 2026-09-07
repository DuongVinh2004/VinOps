-- VIN-MEGA-017 / ADR-015 PKI Remote Signing & Legal Digital Signatures
-- Multi-tenant PKI digital signature workflow, CSC remote signing credentials,
-- signature sessions, PAdES signatures, and as-built electronic dossiers.

CREATE TABLE vinops.signing_provider_configs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  provider_code text NOT NULL,
  provider_name text NOT NULL,
  base_url text NOT NULL,
  client_id text,
  client_secret text,
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, provider_code),
  CHECK (length(trim(provider_code)) > 0),
  CHECK (length(trim(provider_name)) > 0)
);
CREATE INDEX IF NOT EXISTS signing_provider_configs_idx
  ON vinops.signing_provider_configs (project_id, provider_code, is_active);

CREATE TABLE vinops.user_signing_credentials (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  provider_code text NOT NULL,
  credential_id text NOT NULL,
  certificate_serial text,
  certificate_subject_dn text,
  certificate_valid_from timestamptz,
  certificate_valid_to timestamptz,
  auth_mode text NOT NULL DEFAULT 'push_notification' CHECK (auth_mode IN ('push_notification', 'otp_sms', 'otp_email')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, user_id, provider_code),
  CHECK (length(trim(credential_id)) > 0)
);
CREATE INDEX IF NOT EXISTS user_signing_credentials_user_idx
  ON vinops.user_signing_credentials (project_id, user_id, status);

CREATE TABLE vinops.signature_sessions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  signable_type text NOT NULL,
  signable_id uuid NOT NULL,
  signing_order integer NOT NULL CHECK (signing_order > 0),
  required_signer_role text NOT NULL,
  required_signer_user_id uuid NOT NULL REFERENCES vinops.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'otp_sent', 'signed', 'rejected', 'expired', 'skipped')),
  document_hash text NOT NULL,
  csc_transaction_id text,
  rejection_reason text,
  signature_value text,
  tsa_token text,
  tsa_timestamp timestamptz,
  expires_at timestamptz NOT NULL,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (signable_type, signable_id, signing_order)
);
CREATE INDEX IF NOT EXISTS signature_sessions_signable_idx
  ON vinops.signature_sessions (project_id, signable_type, signable_id, signing_order);
CREATE INDEX IF NOT EXISTS signature_sessions_signer_status_idx
  ON vinops.signature_sessions (required_signer_user_id, status);

CREATE TABLE vinops.digital_signatures (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES vinops.signature_sessions(id),
  signer_user_id uuid NOT NULL REFERENCES vinops.users(id),
  certificate_serial text,
  signature_algorithm text NOT NULL DEFAULT 'RSA-SHA256' CHECK (signature_algorithm IN ('RSA-SHA256', 'ECDSA-SHA256', 'RSA-SHA384')),
  signature_value_b64 text NOT NULL,
  signed_document_file_id uuid NOT NULL REFERENCES vinops.file_objects(id),
  pades_level text NOT NULL DEFAULT 'B-T' CHECK (pades_level IN ('B-B', 'B-T', 'B-LT', 'B-LTA')),
  tsa_response_b64 text,
  tsa_timestamp timestamptz,
  verification_status text NOT NULL DEFAULT 'valid' CHECK (verification_status IN ('valid', 'invalid', 'expired', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (session_id),
  CHECK (length(trim(signature_value_b64)) > 0)
);
CREATE INDEX IF NOT EXISTS digital_signatures_project_idx
  ON vinops.digital_signatures (project_id, signer_user_id, verification_status);

CREATE TABLE vinops.as_built_dossiers (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  dossier_type text NOT NULL,
  status text NOT NULL DEFAULT 'assembling' CHECK (status IN ('assembling', 'sealed', 'archived')),
  sealed_hash text,
  sealed_at timestamptz,
  sealed_by uuid REFERENCES vinops.users(id),
  hash_chain jsonb,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) > 0),
  CHECK (length(trim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS as_built_dossiers_project_status_idx
  ON vinops.as_built_dossiers (project_id, status);

CREATE TABLE vinops.dossier_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  dossier_id uuid NOT NULL REFERENCES vinops.as_built_dossiers(id),
  item_type text NOT NULL,
  item_entity_id uuid NOT NULL,
  item_file_id uuid NOT NULL REFERENCES vinops.file_objects(id),
  item_hash text NOT NULL,
  sequence integer NOT NULL CHECK (sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (dossier_id, sequence),
  CHECK (length(trim(item_hash)) > 0)
);
CREATE INDEX IF NOT EXISTS dossier_items_dossier_seq_idx
  ON vinops.dossier_items (dossier_id, sequence);

-- Helper function for system/security admin check
CREATE OR REPLACE FUNCTION vinops.is_system_admin(p_user_id uuid DEFAULT vinops.current_actor_id())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT vinops.has_platform_entitlement('system_admin', p_user_id)
     OR EXISTS (
       SELECT 1 FROM vinops.organization_members om
       WHERE om.user_id = p_user_id
         AND om.status = 'Active'
         AND ('system_admin' = ANY(om.roles) OR 'organization_owner' = ANY(om.roles))
     );
$$;

-- Triggers: touch_updated_at, increment_version, prevent_delete
CREATE TRIGGER signing_provider_configs_touch
  BEFORE UPDATE ON vinops.signing_provider_configs
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER signing_provider_configs_version
  BEFORE UPDATE ON vinops.signing_provider_configs
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER signing_provider_configs_no_delete
  BEFORE DELETE ON vinops.signing_provider_configs
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER user_signing_credentials_touch
  BEFORE UPDATE ON vinops.user_signing_credentials
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER user_signing_credentials_version
  BEFORE UPDATE ON vinops.user_signing_credentials
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER user_signing_credentials_no_delete
  BEFORE DELETE ON vinops.user_signing_credentials
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER signature_sessions_touch
  BEFORE UPDATE ON vinops.signature_sessions
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER signature_sessions_version
  BEFORE UPDATE ON vinops.signature_sessions
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER signature_sessions_no_delete
  BEFORE DELETE ON vinops.signature_sessions
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER digital_signatures_touch
  BEFORE UPDATE ON vinops.digital_signatures
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER digital_signatures_version
  BEFORE UPDATE ON vinops.digital_signatures
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER digital_signatures_no_delete
  BEFORE DELETE ON vinops.digital_signatures
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER as_built_dossiers_touch
  BEFORE UPDATE ON vinops.as_built_dossiers
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER as_built_dossiers_version
  BEFORE UPDATE ON vinops.as_built_dossiers
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER as_built_dossiers_no_delete
  BEFORE DELETE ON vinops.as_built_dossiers
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

CREATE TRIGGER dossier_items_touch
  BEFORE UPDATE ON vinops.dossier_items
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();
CREATE TRIGGER dossier_items_version
  BEFORE UPDATE ON vinops.dossier_items
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();
CREATE TRIGGER dossier_items_no_delete
  BEFORE DELETE ON vinops.dossier_items
  FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete();

-- Row Level Security (RLS)
ALTER TABLE vinops.signing_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.user_signing_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.signature_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.digital_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.as_built_dossiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE vinops.dossier_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY signing_provider_configs_tenant ON vinops.signing_provider_configs
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY user_signing_credentials_tenant ON vinops.user_signing_credentials
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY signature_sessions_tenant ON vinops.signature_sessions
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY digital_signatures_tenant ON vinops.digital_signatures
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY as_built_dossiers_tenant ON vinops.as_built_dossiers
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY dossier_items_tenant ON vinops.dossier_items
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

-- Role Grants
GRANT SELECT, INSERT, UPDATE ON vinops.signing_provider_configs TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.user_signing_credentials TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.signature_sessions TO vinops_app;
GRANT SELECT, INSERT ON vinops.digital_signatures TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.as_built_dossiers TO vinops_app;
GRANT SELECT, INSERT, UPDATE ON vinops.dossier_items TO vinops_app;

GRANT SELECT ON vinops.signature_sessions, vinops.digital_signatures, vinops.signing_provider_configs, vinops.as_built_dossiers, vinops.dossier_items TO vinops_worker;
GRANT UPDATE ON vinops.as_built_dossiers TO vinops_worker;
