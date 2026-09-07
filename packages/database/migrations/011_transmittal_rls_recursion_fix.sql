-- Break the transmittals -> transmittal_items -> transmittals RLS dependency cycle.
-- The direct project check is equivalent to the prior parent-project check because
-- (project_id, transmittal_id) references transmittals(project_id, id).

DROP POLICY transmittal_items_scoped ON vinops.transmittal_items;

CREATE POLICY transmittal_items_scoped ON vinops.transmittal_items
  USING (vinops.can_access_project(project_id))
  WITH CHECK (vinops.can_access_project(project_id));
