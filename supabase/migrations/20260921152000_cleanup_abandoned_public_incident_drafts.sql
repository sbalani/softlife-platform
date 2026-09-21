CREATE OR REPLACE FUNCTION public.cleanup_abandoned_public_incident_drafts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE v_deleted INTEGER;
BEGIN
  DELETE FROM storage.objects object
  USING public.public_incident_attachments attachment, public.public_incident_submissions submission
  WHERE object.bucket_id = 'public-incident-evidence'
    AND object.name = attachment.storage_path
    AND attachment.submission_id = submission.id
    AND submission.status = 'draft'
    AND submission.token_expires_at < now() - INTERVAL '24 hours';

  DELETE FROM public.public_incident_attachments attachment
  USING public.public_incident_submissions submission
  WHERE attachment.submission_id = submission.id
    AND submission.status = 'draft'
    AND submission.token_expires_at < now() - INTERVAL '24 hours';

  DELETE FROM public.public_incident_submissions
  WHERE status = 'draft' AND token_expires_at < now() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_abandoned_public_incident_drafts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_abandoned_public_incident_drafts() TO service_role;

DO $$
DECLARE existing_job RECORD;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname = 'cleanup-abandoned-public-incident-drafts' LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'cleanup-abandoned-public-incident-drafts',
    '17 3 * * *',
    'SELECT public.cleanup_abandoned_public_incident_drafts()'
  );
END;
$$;
