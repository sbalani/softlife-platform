CREATE OR REPLACE FUNCTION public.resolve_prior_cash_discrepancy_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    UPDATE public.machine_cash_alerts
    SET resolved_at = now(), resolution_source = 'reconciliation'
    WHERE machine_id = NEW.machine_id
      AND alert_type = 'discrepancy'
      AND resolved_at IS NULL
      AND reconciliation_report_id IS DISTINCT FROM NEW.report_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_action_cash_reconciliation_resolves_prior_alerts
AFTER INSERT OR UPDATE OF status ON public.service_action_cash_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.resolve_prior_cash_discrepancy_alerts();
