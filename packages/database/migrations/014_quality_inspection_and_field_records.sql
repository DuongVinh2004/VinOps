-- VIN-MEGA-003: Quality Inspection (ND 207/2026/ND-CP, TT 32/2026/TT-BXD), Electronic Daily Logs & Offline Ledger.

CREATE TABLE vinops.inspection_templates (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Published', 'Archived')),
  category text NOT NULL DEFAULT 'general',
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 1 AND 120),
  CHECK (length(trim(name)) BETWEEN 1 AND 300)
);
CREATE INDEX inspection_templates_idx ON vinops.inspection_templates (project_id, status, code);

CREATE TABLE vinops.checklist_items (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES vinops.inspection_templates(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  sequence integer NOT NULL DEFAULT 1,
  is_mandatory boolean NOT NULL DEFAULT true,
  requires_evidence boolean NOT NULL DEFAULT false,
  criterion_type text NOT NULL DEFAULT 'pass_fail' CHECK (criterion_type IN ('pass_fail', 'measurement', 'text')),
  unit text,
  min_value numeric(14, 4),
  max_value numeric(14, 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, item_key),
  CHECK (length(trim(item_key)) BETWEEN 1 AND 100),
  CHECK (length(trim(title)) BETWEEN 1 AND 300)
);
CREATE INDEX checklist_items_template_idx ON vinops.checklist_items (template_id, sequence);

CREATE TABLE vinops.inspections (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  template_id uuid REFERENCES vinops.inspection_templates(id),
  code text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'In Progress', 'Completed', 'Accepted', 'Rejected', 'Cancelled')),
  inspector_id uuid NOT NULL REFERENCES vinops.users(id),
  contractor_rep_id uuid REFERENCES vinops.users(id),
  supervisor_rep_id uuid REFERENCES vinops.users(id),
  pmu_rep_id uuid REFERENCES vinops.users(id),
  location_id uuid REFERENCES vinops.location_nodes(id),
  work_item_id uuid REFERENCES vinops.work_nodes(id),
  inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
  notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 1 AND 120),
  CHECK (length(trim(title)) BETWEEN 1 AND 300)
);
CREATE INDEX inspections_project_idx ON vinops.inspections (project_id, status, inspection_date);

CREATE TABLE vinops.inspection_results (
  id uuid PRIMARY KEY,
  inspection_id uuid NOT NULL REFERENCES vinops.inspections(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  result text NOT NULL CHECK (result IN ('Pass', 'Fail', 'NA', 'Pending')),
  value_decimal numeric(14, 4),
  unit text,
  notes text NOT NULL DEFAULT '',
  evidence_file_ids uuid[] NOT NULL DEFAULT '{}',
  recorded_by uuid NOT NULL REFERENCES vinops.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inspection_id, item_key)
);
CREATE INDEX inspection_results_idx ON vinops.inspection_results (inspection_id, result);

CREATE TABLE vinops.inspection_findings (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  inspection_id uuid REFERENCES vinops.inspections(id) ON DELETE SET NULL,
  code text NOT NULL,
  severity text NOT NULL DEFAULT 'Medium' CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Pending Verification', 'Resolved', 'Closed', 'Waived')),
  description text NOT NULL,
  location_detail text NOT NULL DEFAULT '',
  owner_id uuid NOT NULL REFERENCES vinops.users(id),
  due_at timestamptz,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 1 AND 120),
  CHECK (length(trim(description)) BETWEEN 1 AND 2000)
);
CREATE INDEX inspection_findings_idx ON vinops.inspection_findings (project_id, status, severity, due_at);

CREATE TABLE vinops.corrective_actions (
  id uuid PRIMARY KEY,
  finding_id uuid NOT NULL REFERENCES vinops.inspection_findings(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL DEFAULT 1 CHECK (attempt_no > 0),
  description text NOT NULL,
  performer_id uuid NOT NULL REFERENCES vinops.users(id),
  status text NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Verified', 'Rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  verified_by uuid REFERENCES vinops.users(id),
  verified_at timestamptz,
  rejection_reason text,
  evidence_file_ids uuid[] NOT NULL DEFAULT '{}',
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, attempt_no),
  CHECK (length(trim(description)) BETWEEN 1 AND 2000)
);
CREATE INDEX corrective_actions_idx ON vinops.corrective_actions (finding_id, status);

CREATE TABLE vinops.acceptance_records (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  inspection_id uuid REFERENCES vinops.inspections(id),
  code text NOT NULL,
  record_type text NOT NULL DEFAULT 'work_acceptance' CHECK (record_type IN ('work_acceptance', 'stage_acceptance', 'completion_acceptance')),
  legal_basis text NOT NULL DEFAULT 'Nghi dinh 207/2026/ND-CP & Thong tu 32/2026/TT-BXD',
  result text NOT NULL DEFAULT 'Accepted' CHECK (result IN ('Accepted', 'Rejected', 'Conditional')),
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Contractor Signed', 'Supervisor Signed', 'Completed', 'Rejected')),
  contractor_signed_by uuid REFERENCES vinops.users(id),
  contractor_signed_at timestamptz,
  contractor_signature_data text,
  supervisor_signed_by uuid REFERENCES vinops.users(id),
  supervisor_signed_at timestamptz,
  supervisor_signature_data text,
  pmu_signed_by uuid REFERENCES vinops.users(id),
  pmu_signed_at timestamptz,
  pmu_signature_data text,
  conditions_notes text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  authority_policy_version bigint NOT NULL DEFAULT 1 CHECK (authority_policy_version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 1 AND 120)
);
CREATE INDEX acceptance_records_idx ON vinops.acceptance_records (project_id, status, result);

CREATE TABLE vinops.daily_logs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  contract_package_id uuid NOT NULL,
  log_date date NOT NULL,
  shift_code text NOT NULL DEFAULT 'day',
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Submitted', 'Confirmed', 'Amended')),
  author_unit text NOT NULL DEFAULT 'Chinh',
  work_summary text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  site_manager_signed_by uuid REFERENCES vinops.users(id),
  site_manager_signed_at timestamptz,
  site_manager_signature_data text,
  supervisor_signed_by uuid REFERENCES vinops.users(id),
  supervisor_signed_at timestamptz,
  supervisor_signature_data text,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, contract_package_id, log_date)
);
CREATE INDEX daily_logs_search_idx ON vinops.daily_logs (project_id, contract_package_id, log_date, status);

CREATE TABLE vinops.daily_manpower (
  id uuid PRIMARY KEY,
  daily_log_id uuid NOT NULL REFERENCES vinops.daily_logs(id) ON DELETE CASCADE,
  trade_or_subcontractor text NOT NULL,
  skill_level text NOT NULL DEFAULT 'Skilled',
  headcount integer NOT NULL DEFAULT 1 CHECK (headcount > 0),
  hours_worked numeric(6, 2) NOT NULL DEFAULT 8.0 CHECK (hours_worked >= 0),
  notes text NOT NULL DEFAULT ''
);
CREATE INDEX daily_manpower_log_idx ON vinops.daily_manpower (daily_log_id);

CREATE TABLE vinops.daily_weather (
  id uuid PRIMARY KEY,
  daily_log_id uuid NOT NULL REFERENCES vinops.daily_logs(id) ON DELETE CASCADE,
  time_of_day text NOT NULL CHECK (time_of_day IN ('morning', 'noon', 'afternoon')),
  temperature_c numeric(5, 2) NOT NULL,
  weather_condition text NOT NULL DEFAULT 'Sunny' CHECK (weather_condition IN ('Sunny', 'Cloudy', 'Rainy', 'Stormy', 'Windy')),
  rainfall_mm numeric(6, 2) NOT NULL DEFAULT 0.0 CHECK (rainfall_mm >= 0),
  wind_force text NOT NULL DEFAULT 'Light',
  gps_lat numeric(10, 7),
  gps_lng numeric(10, 7),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'crawled')),
  notes text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (daily_log_id, time_of_day)
);
CREATE INDEX daily_weather_log_idx ON vinops.daily_weather (daily_log_id, time_of_day);

CREATE TABLE vinops.daily_equipment (
  id uuid PRIMARY KEY,
  daily_log_id uuid NOT NULL REFERENCES vinops.daily_logs(id) ON DELETE CASCADE,
  equipment_name text NOT NULL,
  equipment_type text NOT NULL DEFAULT 'General',
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  hours_worked numeric(6, 2) NOT NULL DEFAULT 8.0 CHECK (hours_worked >= 0),
  operational_status text NOT NULL DEFAULT 'Operational' CHECK (operational_status IN ('Operational', 'Standby', 'Breakdown')),
  notes text NOT NULL DEFAULT ''
);
CREATE INDEX daily_equipment_log_idx ON vinops.daily_equipment (daily_log_id);

CREATE TABLE vinops.sync_batches (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  device_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES vinops.users(id),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'partial_conflict', 'failed')),
  operation_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id)
);
CREATE INDEX sync_batches_project_idx ON vinops.sync_batches (project_id, user_id, created_at);

CREATE TABLE vinops.sync_operations (
  id uuid PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES vinops.sync_batches(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_temp_id text NOT NULL,
  command text NOT NULL,
  base_version bigint NOT NULL DEFAULT 1,
  client_created_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'conflict', 'rejected', 'failed')),
  canonical_id uuid,
  canonical_version bigint,
  error_code text,
  conflict_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, operation_id)
);
CREATE INDEX sync_operations_batch_idx ON vinops.sync_operations (batch_id, status);

-- Trigger logic: Invariant freeze for Confirmed daily logs
CREATE OR REPLACE FUNCTION vinops.prevent_frozen_daily_log_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'Confirmed' THEN
    -- If already confirmed, allow status transition ONLY to 'Amended' if explicitly changed, but block all content modification
    IF NEW.status = OLD.status AND (
      NEW.work_summary IS DISTINCT FROM OLD.work_summary OR
      NEW.notes IS DISTINCT FROM OLD.notes OR
      NEW.contract_package_id IS DISTINCT FROM OLD.contract_package_id OR
      NEW.log_date IS DISTINCT FROM OLD.log_date OR
      NEW.shift_code IS DISTINCT FROM OLD.shift_code OR
      NEW.author_unit IS DISTINCT FROM OLD.author_unit OR
      NEW.site_manager_signed_by IS DISTINCT FROM OLD.site_manager_signed_by OR
      NEW.site_manager_signature_data IS DISTINCT FROM OLD.site_manager_signature_data OR
      NEW.supervisor_signed_by IS DISTINCT FROM OLD.supervisor_signed_by OR
      NEW.supervisor_signature_data IS DISTINCT FROM OLD.supervisor_signature_data
    ) THEN
      RAISE EXCEPTION 'Daily log % is Confirmed and frozen against content modification.', OLD.id
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_log_freeze_check
  BEFORE UPDATE ON vinops.daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION vinops.prevent_frozen_daily_log_mutation();

-- Trigger logic: Child logs cannot be modified when parent is Confirmed
CREATE OR REPLACE FUNCTION vinops.prevent_child_log_mutation_when_frozen()
RETURNS trigger AS $$
DECLARE
  target_log_id uuid;
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_log_id := OLD.daily_log_id;
  ELSE
    target_log_id := NEW.daily_log_id;
  END IF;

  SELECT status INTO parent_status FROM vinops.daily_logs WHERE id = target_log_id;
  IF parent_status = 'Confirmed' THEN
    RAISE EXCEPTION 'Cannot modify child records for Confirmed daily log %.', target_log_id
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER manpower_parent_freeze_check
  BEFORE INSERT OR UPDATE OR DELETE ON vinops.daily_manpower
  FOR EACH ROW
  EXECUTE FUNCTION vinops.prevent_child_log_mutation_when_frozen();

CREATE TRIGGER weather_parent_freeze_check
  BEFORE INSERT OR UPDATE OR DELETE ON vinops.daily_weather
  FOR EACH ROW
  EXECUTE FUNCTION vinops.prevent_child_log_mutation_when_frozen();

CREATE TRIGGER equipment_parent_freeze_check
  BEFORE INSERT OR UPDATE OR DELETE ON vinops.daily_equipment
  FOR EACH ROW
  EXECUTE FUNCTION vinops.prevent_child_log_mutation_when_frozen();

-- Row Level Security (RLS)
DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'inspection_templates', 'checklist_items', 'inspections', 'inspection_results',
    'inspection_findings', 'corrective_actions', 'acceptance_records', 'daily_logs',
    'daily_manpower', 'daily_weather', 'daily_equipment', 'sync_batches', 'sync_operations'
  ] LOOP
    EXECUTE format('ALTER TABLE vinops.%I ENABLE ROW LEVEL SECURITY', target_table);
  END LOOP;
END;
$$;

-- RLS Policies
CREATE POLICY inspection_templates_scoped ON vinops.inspection_templates
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY checklist_items_scoped ON vinops.checklist_items
  USING (EXISTS (SELECT 1 FROM vinops.inspection_templates t WHERE t.id = checklist_items.template_id AND vinops.can_access_project(t.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.inspection_templates t WHERE t.id = checklist_items.template_id AND vinops.can_access_project(t.project_id)));

CREATE POLICY inspections_scoped ON vinops.inspections
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY inspection_results_scoped ON vinops.inspection_results
  USING (EXISTS (SELECT 1 FROM vinops.inspections i WHERE i.id = inspection_results.inspection_id AND vinops.can_access_project(i.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.inspections i WHERE i.id = inspection_results.inspection_id AND vinops.can_access_project(i.project_id)));

CREATE POLICY inspection_findings_scoped ON vinops.inspection_findings
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY corrective_actions_scoped ON vinops.corrective_actions
  USING (EXISTS (SELECT 1 FROM vinops.inspection_findings f WHERE f.id = corrective_actions.finding_id AND vinops.can_access_project(f.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.inspection_findings f WHERE f.id = corrective_actions.finding_id AND vinops.can_access_project(f.project_id)));

CREATE POLICY acceptance_records_scoped ON vinops.acceptance_records
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY daily_logs_scoped ON vinops.daily_logs
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY daily_manpower_scoped ON vinops.daily_manpower
  USING (EXISTS (SELECT 1 FROM vinops.daily_logs l WHERE l.id = daily_manpower.daily_log_id AND vinops.can_access_project(l.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.daily_logs l WHERE l.id = daily_manpower.daily_log_id AND vinops.can_access_project(l.project_id)));

CREATE POLICY daily_weather_scoped ON vinops.daily_weather
  USING (EXISTS (SELECT 1 FROM vinops.daily_logs l WHERE l.id = daily_weather.daily_log_id AND vinops.can_access_project(l.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.daily_logs l WHERE l.id = daily_weather.daily_log_id AND vinops.can_access_project(l.project_id)));

CREATE POLICY daily_equipment_scoped ON vinops.daily_equipment
  USING (EXISTS (SELECT 1 FROM vinops.daily_logs l WHERE l.id = daily_equipment.daily_log_id AND vinops.can_access_project(l.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.daily_logs l WHERE l.id = daily_equipment.daily_log_id AND vinops.can_access_project(l.project_id)));

CREATE POLICY sync_batches_scoped ON vinops.sync_batches
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));

CREATE POLICY sync_operations_scoped ON vinops.sync_operations
  USING (EXISTS (SELECT 1 FROM vinops.sync_batches b WHERE b.id = sync_operations.batch_id AND vinops.can_access_project(b.project_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM vinops.sync_batches b WHERE b.id = sync_operations.batch_id AND vinops.can_access_project(b.project_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA vinops TO vinops_app;
GRANT SELECT ON vinops.acceptance_records, vinops.inspections, vinops.checklist_items,
  vinops.inspection_findings, vinops.corrective_actions, vinops.daily_logs,
  vinops.daily_manpower, vinops.daily_weather, vinops.daily_equipment TO vinops_worker;
GRANT INSERT, UPDATE ON vinops.daily_weather TO vinops_worker;
