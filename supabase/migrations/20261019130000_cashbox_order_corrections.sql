CREATE TABLE public.machine_cash_reconciliation_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_report_id UUID NOT NULL REFERENCES public.service_action_cash_reconciliations(report_id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  export_version BIGINT NOT NULL,
  contribution_delta_cents BIGINT NOT NULL CHECK (contribution_delta_cents <> 0),
  reason TEXT NOT NULL CHECK (reason IN ('late_order', 'order_correction', 'machine_reassignment')),
  source_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reconciliation_report_id, order_id, export_version, reason, contribution_delta_cents)
);
ALTER TABLE public.machine_cash_reconciliation_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.machine_cash_reconciliation_corrections FROM PUBLIC, anon, authenticated;

CREATE TRIGGER machine_cash_reconciliation_corrections_immutable
BEFORE UPDATE OR DELETE ON public.machine_cash_reconciliation_corrections
FOR EACH ROW EXECUTE FUNCTION public.prevent_cash_audit_mutation();

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
  UPDATE public.machine_cash_alerts
  SET message = 'After late-order attribution, the physical cash count differs from the expected balance by EUR '
      || to_char(abs(v_corrected_discrepancy) / 100.0, 'FM999999990.00') || '.',
      resolved_at = CASE WHEN abs(v_corrected_discrepancy) < 1000 THEN now() ELSE resolved_at END,
      resolution_source = CASE WHEN abs(v_corrected_discrepancy) < 1000 THEN 'reconciliation' ELSE resolution_source END
  WHERE reconciliation_report_id = v_reconciliation.report_id
    AND alert_type = 'discrepancy' AND resolved_at IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.project_machine_cash_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_projection RECORD;
  v_previous public.machine_cash_order_projections%ROWTYPE;
  v_delta BIGINT;
  v_version BIGINT := COALESCE(NEW.export_version, 1);
BEGIN
  SELECT * INTO v_previous FROM public.machine_cash_order_projections WHERE order_id = NEW.id FOR UPDATE;

  IF NEW.machine_id IS NULL THEN
    IF v_previous.order_id IS NOT NULL THEN
      IF v_previous.contribution_cents <> 0 THEN
        INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, order_id, reference_key, metadata)
        VALUES (v_previous.machine_id, 'cash_sale_correction', -v_previous.contribution_cents,
          COALESCE(v_previous.order_time, now()), NEW.id, 'order:' || NEW.id || ':projection:' || v_version || ':unassigned',
          jsonb_build_object('reason', 'machine_unassigned', 'previous', v_previous.source_snapshot))
        ON CONFLICT (reference_key) DO NOTHING;
        PERFORM public.record_cash_reconciliation_correction(
          v_previous.machine_id, NEW.id, v_previous.order_time, v_version,
          -v_previous.contribution_cents, 'machine_reassignment', v_previous.source_snapshot
        );
      END IF;
      DELETE FROM public.machine_cash_order_projections WHERE order_id = NEW.id;
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO v_projection FROM public.cash_order_projection_values(NEW);
  IF v_previous.order_id IS NOT NULL AND v_previous.machine_id <> NEW.machine_id THEN
    IF v_previous.contribution_cents <> 0 THEN
      INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, order_id, reference_key, metadata)
      VALUES (v_previous.machine_id, 'cash_sale_correction', -v_previous.contribution_cents,
        COALESCE(v_previous.order_time, now()), NEW.id, 'order:' || NEW.id || ':projection:' || v_version || ':move-out',
        jsonb_build_object('reason', 'machine_reassignment', 'new_machine_id', NEW.machine_id, 'previous', v_previous.source_snapshot))
      ON CONFLICT (reference_key) DO NOTHING;
      PERFORM public.record_cash_reconciliation_correction(
        v_previous.machine_id, NEW.id, v_previous.order_time, v_version,
        -v_previous.contribution_cents, 'machine_reassignment', v_previous.source_snapshot
      );
    END IF;
    v_delta := v_projection.contribution_cents;
  ELSE
    v_delta := v_projection.contribution_cents - COALESCE(v_previous.contribution_cents, 0);
    IF v_previous.order_id IS NOT NULL
      AND v_previous.order_time IS DISTINCT FROM NEW.order_time
      AND v_previous.contribution_cents <> 0
    THEN
      PERFORM public.record_cash_reconciliation_correction(
        v_previous.machine_id, NEW.id, v_previous.order_time, v_version,
        -v_previous.contribution_cents, 'order_correction', v_previous.source_snapshot
      );
      PERFORM public.record_cash_reconciliation_correction(
        NEW.machine_id, NEW.id, NEW.order_time, v_version,
        v_projection.contribution_cents, 'order_correction', v_projection.source_snapshot
      );
    END IF;
  END IF;

  INSERT INTO public.machine_cash_order_projections(
    order_id, machine_id, order_time, contribution_cents, projection_status, source_snapshot, projected_at
  ) VALUES (
    NEW.id, NEW.machine_id, NEW.order_time, v_projection.contribution_cents,
    v_projection.projection_status, v_projection.source_snapshot, now()
  ) ON CONFLICT (order_id) DO UPDATE SET
    machine_id = EXCLUDED.machine_id,
    order_time = EXCLUDED.order_time,
    contribution_cents = EXCLUDED.contribution_cents,
    projection_status = EXCLUDED.projection_status,
    source_snapshot = EXCLUDED.source_snapshot,
    projected_at = now();

  IF v_delta <> 0 THEN
    INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, order_id, reference_key, metadata)
    VALUES (
      NEW.machine_id,
      CASE WHEN v_previous.order_id IS NULL OR v_previous.machine_id <> NEW.machine_id THEN 'cash_sale' ELSE 'cash_sale_correction' END,
      v_delta, COALESCE(NEW.order_time, now()), NEW.id,
      'order:' || NEW.id || ':projection:' || v_version || CASE WHEN v_previous.machine_id IS DISTINCT FROM NEW.machine_id THEN ':move-in' ELSE '' END,
      jsonb_build_object('projection_status', v_projection.projection_status, 'source', v_projection.source_snapshot)
    ) ON CONFLICT (reference_key) DO NOTHING;
    PERFORM public.record_cash_reconciliation_correction(
      NEW.machine_id, NEW.id, NEW.order_time, v_version, v_delta,
      CASE WHEN v_previous.order_id IS NULL THEN 'late_order'
        WHEN v_previous.machine_id IS DISTINCT FROM NEW.machine_id THEN 'machine_reassignment'
        ELSE 'order_correction' END,
      v_projection.source_snapshot
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_cash_anchor_regression()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.anchor_at < OLD.anchor_at THEN RAISE EXCEPTION 'Cash balance anchors cannot move backward'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER machine_cash_accounts_anchor_monotonic
BEFORE UPDATE OF anchor_at ON public.machine_cash_accounts
FOR EACH ROW EXECUTE FUNCTION public.prevent_cash_anchor_regression();

REVOKE ALL ON FUNCTION public.record_cash_reconciliation_correction(UUID, UUID, TIMESTAMPTZ, BIGINT, BIGINT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
