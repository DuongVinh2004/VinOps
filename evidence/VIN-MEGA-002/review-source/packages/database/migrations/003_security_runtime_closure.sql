-- Organization membership alone is not project authorization. Project rows
-- are visible only through an effective project membership or an explicitly
-- elevated organization role evaluated by can_access_project.
DROP POLICY IF EXISTS projects_visible ON vinops.projects;

CREATE POLICY projects_visible ON vinops.projects
  USING (vinops.can_access_project(id))
  WITH CHECK (vinops.can_access_organization(organization_id));
