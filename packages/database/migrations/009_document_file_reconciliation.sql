-- VIN-MEGA-002 additive reconciliation worker contract.
-- Reconciliation never promotes an object to Available: a scanner result is required.
CREATE FUNCTION vinops.complete_file_reconciliation(
  p_job_id uuid,
  p_file_id uuid,
  p_worker_name text,
  p_failure_code text,
  p_actual_size_bytes bigint,
  p_actual_sha256 char(64)
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
DECLARE
  file vinops.file_objects%ROWTYPE;
BEGIN
  SELECT * INTO file FROM vinops.file_objects WHERE id = p_file_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_NOT_FOUND'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM vinops.file_processing_jobs job
     WHERE job.id = p_job_id AND job.file_id = p_file_id
       AND job.job_type = 'reconcile'
       AND job.status = 'Claimed' AND job.claimed_by = p_worker_name
  ) THEN RAISE EXCEPTION 'FILE_RECONCILIATION_NOT_CLAIMED'; END IF;

  -- A reconciliation sweep may quarantine an orphan or stuck object, but it is
  -- deliberately unable to bypass validation, malware scan, or publication.
  IF file.status <> 'Available' THEN
    UPDATE vinops.file_objects
       SET status = 'Quarantined',
           failure_code = COALESCE(p_failure_code, 'RECONCILIATION_REQUIRED'),
           actual_size_bytes = p_actual_size_bytes,
           actual_sha256 = p_actual_sha256
     WHERE id = p_file_id;
  END IF;
  UPDATE vinops.file_processing_jobs
     SET status = 'Completed', completed_at = now(), last_error_code = COALESCE(p_failure_code, last_error_code)
   WHERE id = p_job_id AND status = 'Claimed' AND claimed_by = p_worker_name;
  INSERT INTO vinops.outbox_events (
    id, organization_id, project_id, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    gen_random_uuid(), file.organization_id, file.project_id, 'file_object', file.id,
    'file.reconciliation.completed.v1',
    jsonb_build_object('file_id', file.id, 'failure_code', COALESCE(p_failure_code, 'RECONCILIATION_REQUIRED'))
  );
END;
$$;

REVOKE ALL ON FUNCTION vinops.complete_file_reconciliation(uuid, uuid, text, text, bigint, char(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.complete_file_reconciliation(uuid, uuid, text, text, bigint, char(64)) TO vinops_worker;
ALTER FUNCTION vinops.complete_file_reconciliation(uuid, uuid, text, text, bigint, char(64)) OWNER TO vinops_owner;
