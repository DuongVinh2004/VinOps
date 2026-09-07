-- Include the job type so the worker can separate validation from reconciliation.
DROP FUNCTION vinops.claim_file_processing_jobs(text, integer);

CREATE FUNCTION vinops.claim_file_processing_jobs(p_worker_name text, p_limit integer)
RETURNS TABLE (
  job_id uuid,
  file_id uuid,
  organization_id uuid,
  project_id uuid,
  job_type text,
  storage_bucket text,
  quarantine_object_key text,
  declared_size_bytes bigint,
  declared_media_type text,
  declared_sha256 char(64),
  original_filename text,
  attempts integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vinops, pg_catalog AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT job.id FROM vinops.file_processing_jobs job
     WHERE job.status IN ('Pending', 'Retry') AND job.available_at <= now()
     ORDER BY job.available_at, job.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(p_limit, 100))
  ), claimed AS (
    UPDATE vinops.file_processing_jobs job
       SET status = 'Claimed', claimed_at = now(), claimed_by = p_worker_name, attempts = job.attempts + 1
      FROM candidates WHERE job.id = candidates.id
      RETURNING job.*
  )
  SELECT claimed.id, file.id, file.organization_id, file.project_id, claimed.job_type,
         file.storage_bucket, file.quarantine_object_key, file.declared_size_bytes,
         file.declared_media_type, file.declared_sha256, file.original_filename, claimed.attempts
    FROM claimed JOIN vinops.file_objects file ON file.id = claimed.file_id;
END;
$$;

REVOKE ALL ON FUNCTION vinops.claim_file_processing_jobs(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinops.claim_file_processing_jobs(text, integer) TO vinops_worker;
ALTER FUNCTION vinops.claim_file_processing_jobs(text, integer) OWNER TO vinops_owner;
