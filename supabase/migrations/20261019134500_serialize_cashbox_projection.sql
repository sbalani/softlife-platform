CREATE OR REPLACE FUNCTION public.lock_machine_cash_projection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM account.machine_id
  FROM public.machine_cash_accounts account
  WHERE account.machine_id IN (CASE WHEN TG_OP = 'UPDATE' THEN OLD.machine_id END, NEW.machine_id)
  ORDER BY account.machine_id
  FOR UPDATE;
  RETURN NEW;
END;
$$;

CREATE TRIGGER huaxin_orders_lock_machine_cash_projection
BEFORE INSERT OR UPDATE OF machine_id, order_time, order_state, status_code, price, pay_type_raw, refund_status
ON public.huaxin_orders
FOR EACH ROW EXECUTE FUNCTION public.lock_machine_cash_projection();

CREATE OR REPLACE FUNCTION public.record_cash_reconciliation_correction(
  p_machine_id UUID,
  p_order_id UUID,
  p_order_time TIMESTAMPTZ,
  p_export_version BIGINT,
  p_delta_cents BIGINT,
  p_reason TEXT,
  p_source_snapshot JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reconciliation public.service_action_cash_reconciliations%ROWTYPE;
  v_correction_total BIGINT;
  v_corrected_discrepancy BIGINT;
  v_message TEXT;
  v_severity TEXT;
BEGIN
  IF p_delta_cents = 0 OR p_order_time IS NULL THEN RETURN; END IF;
  SELECT * INTO v_reconciliation
  FROM public.service_action_cash_reconciliations reconciliation
  WHERE reconciliation.machine_id = p_machine_id
    AND reconciliation.status = 'confirmed'
    AND p_order_time > reconciliation.period_started_at
    AND p_order_time <= reconciliation.period_ended_at
  ORDER BY reconciliation.period_ended_at DESC
  LIMIT 1;
  IF v_reconciliation.report_id IS NULL THEN RETURN; END IF;

  INSERT INTO public.machine_cash_reconciliation_corrections(
    reconciliation_report_id, order_id, export_version, contribution_delta_cents, reason, source_snapshot
  ) VALUES (
    v_reconciliation.report_id, p_order_id, p_export_version, p_delta_cents, p_reason, p_source_snapshot
  ) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(sum(correction.contribution_delta_cents), 0)::BIGINT INTO v_correction_total
  FROM public.machine_cash_reconciliation_corrections correction
  WHERE correction.reconciliation_report_id = v_reconciliation.report_id;
  v_corrected_discrepancy := v_reconciliation.discrepancy_cents - v_correction_total;
  IF abs(v_corrected_discrepancy) < 1000 THEN
    UPDATE public.machine_cash_alerts SET resolved_at = now(), resolution_source = 'reconciliation'
    WHERE reconciliation_report_id = v_reconciliation.report_id
      AND alert_type = 'discrepancy' AND resolved_at IS NULL;
    RETURN;
  END IF;

  v_message := 'After late-order attribution, the physical cash count differs from the expected balance by EUR '
    || to_char(abs(v_corrected_discrepancy) / 100.0, 'FM999999990.00') || '.';
  v_severity := CASE WHEN abs(v_corrected_discrepancy) >= 5000 THEN 'critical' ELSE 'warning' END;
  UPDATE public.machine_cash_alerts SET message = v_message, severity = v_severity
  WHERE reconciliation_report_id = v_reconciliation.report_id
    AND alert_type = 'discrepancy' AND resolved_at IS NULL;
  IF NOT FOUND THEN
    INSERT INTO public.machine_cash_alerts(
      machine_id, alert_type, severity, title, message, reconciliation_report_id
    ) VALUES (
      p_machine_id, 'discrepancy', v_severity, 'Cash count discrepancy', v_message, v_reconciliation.report_id
    );
  END IF;
END;
$$;
