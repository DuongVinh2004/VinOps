-- VIN-MEGA-SLICE-B: Field Issues, RFI and Submittals schema, constraints, triggers and RLS policies.

-- 1. Extend project_members with optional partner_organization_id for contractor scoping
ALTER TABLE vinops.project_members
  ADD COLUMN IF NOT EXISTS partner_organization_id uuid REFERENCES vinops.partner_organizations(id);

CREATE INDEX IF NOT EXISTS project_members_partner_org_idx
  ON vinops.project_members (project_id, partner_organization_id)
  WHERE partner_organization_id IS NOT NULL;

-- Helper functions for contractor & supervisor resolution
CREATE OR REPLACE FUNCTION vinops.user_partner_organization_id(
  p_project_id uuid,
  p_user_id uuid DEFAULT vinops.current_actor_id()
)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT partner_organization_id
    FROM vinops.project_members
   WHERE project_id = p_project_id
     AND user_id = p_user_id
     AND status = 'Active'
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION vinops.is_project_supervisor(
  p_project_id uuid,
  p_user_id uuid DEFAULT vinops.current_actor_id()
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM vinops.project_members
     WHERE project_id = p_project_id
       AND user_id = p_user_id
       AND status = 'Active'
       AND (valid_from IS NULL OR valid_from <= now())
       AND (valid_to IS NULL OR valid_to > now())
       AND roles && ARRAY['project_admin', 'pm_cht', 'consultant_lead', 'qa_qc_manager', 'organization_owner']::text[]
  ) OR EXISTS (
    SELECT 1
      FROM vinops.projects p
     WHERE p.id = p_project_id
       AND (
         vinops.has_organization_role(p.organization_id, 'organization_owner', p_user_id)
         OR vinops.has_organization_role(p.organization_id, 'security_admin', p_user_id)
       )
  );
$$;

-- 2. FIELD ISSUES
CREATE TABLE vinops.field_issues (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'Open'
    CHECK (status IN ('Open', 'Under Triage', 'Assigned', 'In Progress', 'Resolved', 'Closed')),
  location_node_id uuid REFERENCES vinops.location_nodes(id),
  work_node_id uuid REFERENCES vinops.work_nodes(id),
  contractor_organization_id uuid REFERENCES vinops.partner_organizations(id),
  suggested_contractor_organization_id uuid REFERENCES vinops.partner_organizations(id),
  assigned_to_user_id uuid REFERENCES vinops.users(id),
  gps_latitude numeric(10, 7) CHECK (gps_latitude BETWEEN -90 AND 90),
  gps_longitude numeric(10, 7) CHECK (gps_longitude BETWEEN -180 AND 180),
  gps_accuracy_meters numeric(8, 2),
  due_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  escalated_to_rfi_id uuid,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 1 AND 60),
  CHECK (length(trim(title)) BETWEEN 1 AND 255),
  CHECK (length(trim(description)) > 0)
);
CREATE INDEX field_issues_lookup_idx
  ON vinops.field_issues (project_id, status, severity, contractor_organization_id);
CREATE INDEX field_issues_lbs_wbs_idx
  ON vinops.field_issues (project_id, location_node_id, work_node_id);

-- 3. ISSUE ATTACHMENTS
CREATE TABLE vinops.issue_attachments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  issue_id uuid NOT NULL REFERENCES vinops.field_issues(id),
  file_id uuid NOT NULL REFERENCES vinops.file_objects(id),
  attachment_type text NOT NULL DEFAULT 'site_photo'
    CHECK (attachment_type IN ('site_photo', 'evidence', 'document', 'resolution_photo')),
  caption text,
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (issue_id, file_id)
);
CREATE INDEX issue_attachments_issue_idx ON vinops.issue_attachments (issue_id);

-- 4. ISSUE COMMENTS
CREATE TABLE vinops.issue_comments (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  issue_id uuid NOT NULL REFERENCES vinops.field_issues(id),
  author_user_id uuid NOT NULL REFERENCES vinops.users(id),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(content)) > 0)
);
CREATE INDEX issue_comments_issue_idx ON vinops.issue_comments (issue_id, created_at);

-- 5. RFI REQUESTS
CREATE TABLE vinops.rfi_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  question text NOT NULL,
  suggested_solution text,
  status text NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Submitted', 'Under Review', 'Clarification Required', 'Official Answered', 'Closed')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  location_node_id uuid REFERENCES vinops.location_nodes(id),
  work_node_id uuid REFERENCES vinops.work_nodes(id),
  document_id uuid REFERENCES vinops.documents(id),
  requesting_partner_organization_id uuid NOT NULL REFERENCES vinops.partner_organizations(id),
  responding_partner_organization_id uuid REFERENCES vinops.partner_organizations(id),
  ball_in_court_organization_id uuid REFERENCES vinops.partner_organizations(id),
  source_issue_id uuid REFERENCES vinops.field_issues(id),
  calendar_id uuid REFERENCES vinops.project_calendars(id),
  submitted_at timestamptz,
  due_at timestamptz,
  sla_business_days integer NOT NULL DEFAULT 5 CHECK (sla_business_days > 0),
  answered_at timestamptz,
  closed_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 1 AND 60),
  CHECK (length(trim(title)) BETWEEN 1 AND 255),
  CHECK (length(trim(question)) > 0)
);
CREATE INDEX rfi_requests_lookup_idx
  ON vinops.rfi_requests (project_id, status, ball_in_court_organization_id, due_at);

-- Add deferred foreign key from field_issues to rfi_requests
ALTER TABLE vinops.field_issues
  ADD CONSTRAINT field_issues_escalated_rfi_fk
  FOREIGN KEY (escalated_to_rfi_id) REFERENCES vinops.rfi_requests(id);

-- 6. RFI RESPONSES
CREATE TABLE vinops.rfi_responses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  rfi_id uuid NOT NULL REFERENCES vinops.rfi_requests(id),
  response_type text NOT NULL
    CHECK (response_type IN ('clarification_request', 'clarification_answer', 'official_answer')),
  content text NOT NULL,
  author_user_id uuid NOT NULL REFERENCES vinops.users(id),
  author_partner_organization_id uuid REFERENCES vinops.partner_organizations(id),
  revised_document_id uuid REFERENCES vinops.documents(id),
  revised_document_revision_id uuid REFERENCES vinops.document_revisions(id),
  file_id uuid REFERENCES vinops.file_objects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(content)) > 0)
);
CREATE INDEX rfi_responses_rfi_idx ON vinops.rfi_responses (rfi_id, created_at);

-- 7. SUBMITTALS
CREATE TABLE vinops.submittals (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  code text NOT NULL,
  title text NOT NULL,
  submittal_type text NOT NULL
    CHECK (submittal_type IN ('material_sample', 'shop_drawing', 'method_statement', 'product_data', 'other')),
  status text NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Submitted', 'Under Review', 'Approved', 'Approved with Comments', 'Revise and Resubmit', 'Rejected', 'Closed')),
  maker_partner_organization_id uuid NOT NULL REFERENCES vinops.partner_organizations(id),
  lead_contractor_partner_organization_id uuid REFERENCES vinops.partner_organizations(id),
  consultant_partner_organization_id uuid REFERENCES vinops.partner_organizations(id),
  ball_in_court_organization_id uuid REFERENCES vinops.partner_organizations(id),
  location_node_id uuid REFERENCES vinops.location_nodes(id),
  work_node_id uuid REFERENCES vinops.work_nodes(id),
  specification_document_id uuid REFERENCES vinops.documents(id),
  drawing_document_id uuid REFERENCES vinops.documents(id),
  calendar_id uuid REFERENCES vinops.project_calendars(id),
  submitted_at timestamptz,
  due_at timestamptz,
  sla_business_days integer NOT NULL DEFAULT 7 CHECK (sla_business_days > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES vinops.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (project_id, code),
  CHECK (length(trim(code)) BETWEEN 1 AND 60),
  CHECK (length(trim(title)) BETWEEN 1 AND 255)
);
CREATE INDEX submittals_lookup_idx
  ON vinops.submittals (project_id, status, submittal_type, ball_in_court_organization_id);

-- 8. SUBMITTAL ITEMS
CREATE TABLE vinops.submittal_items (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  submittal_id uuid NOT NULL REFERENCES vinops.submittals(id),
  item_number integer NOT NULL,
  description text NOT NULL,
  manufacturer text,
  model_or_grade text,
  sample_quantity integer DEFAULT 1 CHECK (sample_quantity >= 1),
  physical_sample_received boolean NOT NULL DEFAULT false,
  document_id uuid REFERENCES vinops.documents(id),
  file_id uuid REFERENCES vinops.file_objects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  UNIQUE (submittal_id, item_number),
  CHECK (length(trim(description)) > 0)
);
CREATE INDEX submittal_items_submittal_idx ON vinops.submittal_items (submittal_id);

-- 9. SUBMITTAL REVIEWS
CREATE TABLE vinops.submittal_reviews (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  project_id uuid NOT NULL,
  submittal_id uuid NOT NULL REFERENCES vinops.submittals(id),
  stage text NOT NULL
    CHECK (stage IN ('checker', 'consultant_lead', 'owner_final')),
  reviewer_user_id uuid NOT NULL REFERENCES vinops.users(id),
  reviewer_partner_organization_id uuid REFERENCES vinops.partner_organizations(id),
  decision text NOT NULL
    CHECK (decision IN ('Approved', 'Approved with Comments', 'Revise and Resubmit', 'Rejected')),
  comments text NOT NULL,
  attached_file_id uuid REFERENCES vinops.file_objects(id),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES vinops.projects (organization_id, id),
  CHECK (length(trim(comments)) > 0)
);
CREATE INDEX submittal_reviews_submittal_idx ON vinops.submittal_reviews (submittal_id, reviewed_at);

-- 10. TRIGGERS: prevent delete on all 8 tables
DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'field_issues', 'issue_attachments', 'issue_comments',
    'rfi_requests', 'rfi_responses',
    'submittals', 'submittal_items', 'submittal_reviews'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON vinops.%I FOR EACH ROW EXECUTE FUNCTION vinops.prevent_delete()',
      target_table || '_no_delete', target_table
    );
  END LOOP;
END;
$$;

-- Touch updated_at triggers
CREATE TRIGGER field_issues_touch
  BEFORE UPDATE ON vinops.field_issues
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER rfi_requests_touch
  BEFORE UPDATE ON vinops.rfi_requests
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

CREATE TRIGGER submittals_touch
  BEFORE UPDATE ON vinops.submittals
  FOR EACH ROW EXECUTE FUNCTION vinops.touch_updated_at();

-- Concurrency version increment triggers
CREATE TRIGGER field_issues_version
  BEFORE UPDATE ON vinops.field_issues
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER rfi_requests_version
  BEFORE UPDATE ON vinops.rfi_requests
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

CREATE TRIGGER submittals_version
  BEFORE UPDATE ON vinops.submittals
  FOR EACH ROW EXECUTE FUNCTION vinops.increment_version();

-- 11. ROW LEVEL SECURITY
DO $$
DECLARE target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'field_issues', 'issue_attachments', 'issue_comments',
    'rfi_requests', 'rfi_responses',
    'submittals', 'submittal_items', 'submittal_reviews'
  ] LOOP
    EXECUTE format('ALTER TABLE vinops.%I ENABLE ROW LEVEL SECURITY', target_table);
  END LOOP;
END;
$$;

-- Field Issues RLS
CREATE POLICY field_issues_scoped ON vinops.field_issues
  USING (
    vinops.can_access_project(project_id)
    AND (
      vinops.is_project_supervisor(project_id)
      OR created_by = vinops.current_actor_id()
      OR assigned_to_user_id = vinops.current_actor_id()
      OR contractor_organization_id IS NULL
      OR contractor_organization_id = vinops.user_partner_organization_id(project_id)
    )
  )
  WITH CHECK (
    vinops.can_access_project(project_id)
    AND (
      vinops.is_project_supervisor(project_id)
      OR created_by = vinops.current_actor_id()
      OR contractor_organization_id = vinops.user_partner_organization_id(project_id)
    )
  );

-- Issue Attachments RLS
CREATE POLICY issue_attachments_scoped ON vinops.issue_attachments
  USING (
    EXISTS (
      SELECT 1 FROM vinops.field_issues i
       WHERE i.id = issue_attachments.issue_id
         AND vinops.can_access_project(i.project_id)
    )
  )
  WITH CHECK (vinops.can_access_project(project_id));

-- Issue Comments RLS
CREATE POLICY issue_comments_scoped ON vinops.issue_comments
  USING (
    EXISTS (
      SELECT 1 FROM vinops.field_issues i
       WHERE i.id = issue_comments.issue_id
         AND vinops.can_access_project(i.project_id)
    )
  )
  WITH CHECK (vinops.can_access_project(project_id));

-- RFI Requests RLS
CREATE POLICY rfi_requests_scoped ON vinops.rfi_requests
  USING (
    vinops.can_access_project(project_id)
    AND (
      vinops.is_project_supervisor(project_id)
      OR created_by = vinops.current_actor_id()
      OR requesting_partner_organization_id = vinops.user_partner_organization_id(project_id)
      OR responding_partner_organization_id = vinops.user_partner_organization_id(project_id)
      OR ball_in_court_organization_id = vinops.user_partner_organization_id(project_id)
    )
  )
  WITH CHECK (
    vinops.can_access_project(project_id)
    AND (
      vinops.is_project_supervisor(project_id)
      OR requesting_partner_organization_id = vinops.user_partner_organization_id(project_id)
      OR responding_partner_organization_id = vinops.user_partner_organization_id(project_id)
    )
  );

-- RFI Responses RLS
CREATE POLICY rfi_responses_scoped ON vinops.rfi_responses
  USING (
    EXISTS (
      SELECT 1 FROM vinops.rfi_requests r
       WHERE r.id = rfi_responses.rfi_id
         AND vinops.can_access_project(r.project_id)
    )
  )
  WITH CHECK (vinops.can_access_project(project_id));

-- Submittals RLS
CREATE POLICY submittals_scoped ON vinops.submittals
  USING (
    vinops.can_access_project(project_id)
    AND (
      vinops.is_project_supervisor(project_id)
      OR created_by = vinops.current_actor_id()
      OR maker_partner_organization_id = vinops.user_partner_organization_id(project_id)
      OR lead_contractor_partner_organization_id = vinops.user_partner_organization_id(project_id)
      OR consultant_partner_organization_id = vinops.user_partner_organization_id(project_id)
      OR ball_in_court_organization_id = vinops.user_partner_organization_id(project_id)
    )
  )
  WITH CHECK (
    vinops.can_access_project(project_id)
    AND (
      vinops.is_project_supervisor(project_id)
      OR maker_partner_organization_id = vinops.user_partner_organization_id(project_id)
      OR lead_contractor_partner_organization_id = vinops.user_partner_organization_id(project_id)
      OR consultant_partner_organization_id = vinops.user_partner_organization_id(project_id)
    )
  );

-- Submittal Items RLS
CREATE POLICY submittal_items_scoped ON vinops.submittal_items
  USING (
    EXISTS (
      SELECT 1 FROM vinops.submittals s
       WHERE s.id = submittal_items.submittal_id
         AND vinops.can_access_project(s.project_id)
    )
  )
  WITH CHECK (vinops.can_access_project(project_id));

-- Submittal Reviews RLS
CREATE POLICY submittal_reviews_scoped ON vinops.submittal_reviews
  USING (
    EXISTS (
      SELECT 1 FROM vinops.submittals s
       WHERE s.id = submittal_reviews.submittal_id
         AND vinops.can_access_project(s.project_id)
    )
  )
  WITH CHECK (vinops.can_access_project(project_id));

-- 12. ROLE GRANTS
GRANT EXECUTE ON FUNCTION vinops.user_partner_organization_id(uuid, uuid) TO vinops_app, vinops_worker;
GRANT EXECUTE ON FUNCTION vinops.is_project_supervisor(uuid, uuid) TO vinops_app, vinops_worker;

GRANT SELECT, INSERT, UPDATE ON TABLE
  vinops.field_issues,
  vinops.issue_attachments,
  vinops.issue_comments,
  vinops.rfi_requests,
  vinops.rfi_responses,
  vinops.submittals,
  vinops.submittal_items,
  vinops.submittal_reviews
TO vinops_app, vinops_worker;
