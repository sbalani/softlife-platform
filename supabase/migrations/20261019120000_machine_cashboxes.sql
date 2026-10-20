ALTER TABLE public.profiles
  ADD COLUMN cash_access BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.machines
  ADD COLUMN cash_tracking_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE public.machine_cash_accounts (
  machine_id UUID PRIMARY KEY REFERENCES public.machines(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL DEFAULT 'EUR' CHECK (currency = 'EUR'),
  anchor_at TIMESTAMPTZ NOT NULL,
  anchor_balance_cents BIGINT NOT NULL CHECK (anchor_balance_cents >= 0),
  opened_at TIMESTAMPTZ NOT NULL,
  opened_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  last_collection_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  disabled_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((disabled_at IS NULL) = (disabled_by IS NULL))
);

CREATE TABLE public.machine_cash_order_projections (
  order_id UUID PRIMARY KEY REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  order_time TIMESTAMPTZ,
  contribution_cents BIGINT NOT NULL DEFAULT 0,
  projection_status TEXT NOT NULL CHECK (projection_status IN ('eligible', 'not_cash', 'not_complete', 'refunded', 'invalid')),
  source_snapshot JSONB NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX machine_cash_order_projections_balance_idx
  ON public.machine_cash_order_projections(machine_id, order_time)
  WHERE contribution_cents <> 0;

CREATE TABLE public.machine_cash_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'opening_balance', 'cash_sale', 'cash_sale_correction', 'withdrawal',
    'count_adjustment', 'admin_balance_anchor', 'closing_withdrawal'
  )),
  amount_cents BIGINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  order_id UUID REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  report_id UUID REFERENCES public.service_action_reports(id) ON DELETE RESTRICT,
  reference_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (amount_cents <> 0 OR entry_type IN ('opening_balance', 'count_adjustment', 'admin_balance_anchor'))
);
CREATE INDEX machine_cash_ledger_machine_time_idx ON public.machine_cash_ledger(machine_id, occurred_at DESC, created_at DESC);

CREATE TABLE public.service_action_cash_reconciliations (
  report_id UUID PRIMARY KEY REFERENCES public.service_action_reports(id) ON DELETE RESTRICT,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed')),
  expected_before_cents BIGINT CHECK (expected_before_cents IS NULL OR expected_before_cents >= 0),
  withdrawal_cents BIGINT NOT NULL CHECK (withdrawal_cents >= 0),
  calculated_remainder_cents BIGINT,
  physical_remainder_cents BIGINT NOT NULL CHECK (physical_remainder_cents >= 0),
  discrepancy_cents BIGINT,
  discrepancy_reason TEXT,
  period_started_at TIMESTAMPTZ,
  period_ended_at TIMESTAMPTZ,
  recorded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status = 'draft' OR (
    expected_before_cents IS NOT NULL AND calculated_remainder_cents IS NOT NULL
    AND discrepancy_cents IS NOT NULL AND period_started_at IS NOT NULL
    AND period_ended_at IS NOT NULL AND confirmed_at IS NOT NULL
  )),
  CHECK (discrepancy_cents IS NULL OR abs(discrepancy_cents) < 1000 OR NULLIF(btrim(discrepancy_reason), '') IS NOT NULL)
);
CREATE INDEX service_action_cash_reconciliations_machine_time_idx
  ON public.service_action_cash_reconciliations(machine_id, period_ended_at DESC)
  WHERE status = 'confirmed';

CREATE TABLE public.service_action_cash_orders (
  report_id UUID NOT NULL REFERENCES public.service_action_cash_reconciliations(report_id) ON DELETE RESTRICT,
  order_id UUID NOT NULL REFERENCES public.huaxin_orders(id) ON DELETE RESTRICT,
  order_time TIMESTAMPTZ NOT NULL,
  contribution_cents BIGINT NOT NULL,
  source_snapshot JSONB NOT NULL,
  PRIMARY KEY (report_id, order_id)
);

CREATE TABLE public.machine_cash_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE RESTRICT,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('discrepancy', 'collection_overdue')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  reconciliation_report_id UUID REFERENCES public.service_action_cash_reconciliations(report_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  resolution_source TEXT CHECK (resolution_source IS NULL OR resolution_source IN ('reconciliation', 'disabled', 'manual')),
  CHECK ((resolved_at IS NULL AND resolved_by IS NULL AND resolution_source IS NULL)
    OR (resolved_at IS NOT NULL AND resolution_source IS NOT NULL))
);
CREATE UNIQUE INDEX machine_cash_alerts_one_overdue
  ON public.machine_cash_alerts(machine_id, alert_type)
  WHERE resolved_at IS NULL AND alert_type = 'collection_overdue';
CREATE INDEX machine_cash_alerts_active_idx ON public.machine_cash_alerts(created_at DESC) WHERE resolved_at IS NULL;

ALTER TABLE public.machine_cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_cash_order_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_cash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_cash_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_action_cash_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_cash_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.machine_cash_accounts, public.machine_cash_order_projections,
  public.machine_cash_ledger, public.service_action_cash_reconciliations,
  public.service_action_cash_orders, public.machine_cash_alerts
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cash_actor_can_access_machine(
  p_actor_id UUID,
  p_machine_id UUID,
  p_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_day DATE := (p_at AT TIME ZONE 'Europe/Madrid')::DATE;
  v_today DATE := (now() AT TIME ZONE 'Europe/Madrid')::DATE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_actor_id;
  IF v_profile.id IS NULL THEN RETURN false; END IF;
  IF v_profile.role = 'admin' THEN RETURN true; END IF;
  IF NOT v_profile.cash_access THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.machines WHERE id = p_machine_id AND deployed AND cash_tracking_enabled) THEN RETURN false; END IF;
  IF v_profile.role = 'operator' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.user_machine_assignments assignment
      WHERE assignment.user_id = p_actor_id AND assignment.machine_id = p_machine_id
        AND assignment.start_date <= v_day AND (assignment.end_date IS NULL OR assignment.end_date >= v_day)
    ) AND EXISTS (
      SELECT 1 FROM public.user_machine_assignments assignment
      WHERE assignment.user_id = p_actor_id AND assignment.machine_id = p_machine_id
        AND assignment.start_date <= v_today AND (assignment.end_date IS NULL OR assignment.end_date >= v_today)
    );
  END IF;
  RETURN v_profile.tenant_id IS NOT NULL
    AND public.current_machine_franchisee(p_machine_id, v_day) = v_profile.tenant_id
    AND public.current_machine_franchisee(p_machine_id, v_today) = v_profile.tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_order_projection_values(p_order public.huaxin_orders)
RETURNS TABLE(contribution_cents BIGINT, projection_status TEXT, source_snapshot JSONB)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_pay_type TEXT := lower(btrim(COALESCE(p_order.pay_type_raw, '')));
  v_complete BOOLEAN := upper(btrim(COALESCE(p_order.order_state, ''))) IN ('3', 'COMPLETE')
    OR upper(btrim(COALESCE(p_order.status_code, ''))) IN ('3', 'COMPLETE');
  v_refunded BOOLEAN := upper(btrim(COALESCE(p_order.refund_status, ''))) IN ('1', 'REFUNDED');
BEGIN
  source_snapshot := jsonb_build_object(
    'order_code', p_order.order_code,
    'order_time', p_order.order_time,
    'order_state', p_order.order_state,
    'status_code', p_order.status_code,
    'pay_type_raw', p_order.pay_type_raw,
    'refund_status', p_order.refund_status,
    'price', p_order.price,
    'export_version', p_order.export_version,
    'export_content_hash', p_order.export_content_hash
  );
  IF p_order.machine_id IS NULL OR p_order.order_time IS NULL OR p_order.price IS NULL OR p_order.price < 0
    OR p_order.price * 100 <> trunc(p_order.price * 100) THEN
    contribution_cents := 0; projection_status := 'invalid'; RETURN NEXT; RETURN;
  END IF;
  IF v_pay_type NOT IN ('cash', 'cash payment', '现金', '现金支付') THEN
    contribution_cents := 0; projection_status := 'not_cash'; RETURN NEXT; RETURN;
  END IF;
  IF NOT v_complete THEN contribution_cents := 0; projection_status := 'not_complete'; RETURN NEXT; RETURN; END IF;
  IF v_refunded THEN contribution_cents := 0; projection_status := 'refunded'; RETURN NEXT; RETURN; END IF;
  contribution_cents := (p_order.price * 100)::BIGINT;
  projection_status := 'eligible';
  RETURN NEXT;
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
BEGIN
  IF NEW.machine_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_projection FROM public.cash_order_projection_values(NEW);
  SELECT * INTO v_previous FROM public.machine_cash_order_projections WHERE order_id = NEW.id FOR UPDATE;
  v_delta := v_projection.contribution_cents - COALESCE(v_previous.contribution_cents, 0);
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
    INSERT INTO public.machine_cash_ledger(
      machine_id, entry_type, amount_cents, occurred_at, order_id, reference_key, metadata
    ) VALUES (
      NEW.machine_id,
      CASE WHEN v_previous.order_id IS NULL THEN 'cash_sale' ELSE 'cash_sale_correction' END,
      v_delta, COALESCE(NEW.order_time, now()), NEW.id,
      'order:' || NEW.id || ':projection:' || COALESCE(NEW.export_version, 1),
      jsonb_build_object('projection_status', v_projection.projection_status, 'source', v_projection.source_snapshot)
    ) ON CONFLICT (reference_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER huaxin_orders_project_machine_cash
AFTER INSERT OR UPDATE OF machine_id, order_time, order_state, status_code, price, pay_type_raw, refund_status, export_version, export_content_hash
ON public.huaxin_orders
FOR EACH ROW EXECUTE FUNCTION public.project_machine_cash_order();

CREATE OR REPLACE FUNCTION public.machine_cash_expected_cents(p_machine_id UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT account.anchor_balance_cents + COALESCE((
    SELECT sum(projection.contribution_cents)
    FROM public.machine_cash_order_projections projection
    WHERE projection.machine_id = account.machine_id
      AND projection.order_time > account.anchor_at
      AND projection.order_time <= p_at
  ), 0)::BIGINT
  FROM public.machine_cash_accounts account
  WHERE account.machine_id = p_machine_id AND account.disabled_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.configure_machine_cashbox(
  p_machine_id UUID,
  p_enabled BOOLEAN,
  p_actor_id UUID,
  p_effective_at TIMESTAMPTZ DEFAULT now(),
  p_balance_cents BIGINT DEFAULT NULL,
  p_final_count_cents BIGINT DEFAULT NULL,
  p_final_withdrawal_cents BIGINT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.machine_cash_accounts%ROWTYPE;
  v_expected BIGINT;
  v_delta BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_actor_id AND role = 'admin') THEN RAISE EXCEPTION 'Admin access required'; END IF;
  IF p_effective_at < TIMESTAMPTZ '2020-01-01' OR p_effective_at > now() + INTERVAL '5 minutes' THEN RAISE EXCEPTION 'Invalid effective time'; END IF;
  PERFORM 1 FROM public.machines WHERE id = p_machine_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Machine not found'; END IF;
  SELECT * INTO v_account FROM public.machine_cash_accounts WHERE machine_id = p_machine_id FOR UPDATE;

  IF p_enabled THEN
    IF p_balance_cents IS NOT NULL AND p_balance_cents < 0 THEN RAISE EXCEPTION 'Cash balance cannot be negative'; END IF;
    IF v_account.machine_id IS NULL OR v_account.disabled_at IS NOT NULL THEN
      IF p_balance_cents IS NULL THEN RAISE EXCEPTION 'Opening balance is required'; END IF;
      INSERT INTO public.machine_cash_accounts(machine_id, anchor_at, anchor_balance_cents, opened_at, opened_by)
      VALUES (p_machine_id, p_effective_at, p_balance_cents, p_effective_at, p_actor_id)
      ON CONFLICT (machine_id) DO UPDATE SET
        anchor_at = EXCLUDED.anchor_at, anchor_balance_cents = EXCLUDED.anchor_balance_cents,
        opened_at = EXCLUDED.opened_at, opened_by = EXCLUDED.opened_by,
        last_collection_at = NULL, disabled_at = NULL, disabled_by = NULL, updated_at = now();
      INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, actor_id, reference_key, metadata)
      VALUES (p_machine_id, 'opening_balance', p_balance_cents, p_effective_at, p_actor_id,
        'opening:' || p_machine_id || ':' || extract(epoch from p_effective_at)::TEXT,
        jsonb_build_object('balance_cents', p_balance_cents));
    ELSIF p_balance_cents IS NOT NULL THEN
      v_expected := public.machine_cash_expected_cents(p_machine_id, p_effective_at);
      v_delta := p_balance_cents - v_expected;
      INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, actor_id, reference_key, metadata)
      VALUES (p_machine_id, 'admin_balance_anchor', v_delta, p_effective_at, p_actor_id,
        'anchor:' || p_machine_id || ':' || extract(epoch from clock_timestamp())::TEXT,
        jsonb_build_object('expected_before_cents', v_expected, 'new_balance_cents', p_balance_cents));
      UPDATE public.machine_cash_accounts SET anchor_at = p_effective_at, anchor_balance_cents = p_balance_cents, updated_at = now()
      WHERE machine_id = p_machine_id;
    END IF;
    UPDATE public.machines SET cash_tracking_enabled = true WHERE id = p_machine_id;
  ELSE
    IF v_account.machine_id IS NOT NULL AND v_account.disabled_at IS NULL THEN
      IF p_final_count_cents IS NULL OR p_final_withdrawal_cents IS NULL THEN RAISE EXCEPTION 'Final count and withdrawal are required'; END IF;
      IF p_final_count_cents < 0 OR p_final_withdrawal_cents < 0 OR p_final_count_cents <> p_final_withdrawal_cents THEN
        RAISE EXCEPTION 'The final withdrawal must remove the full physical count';
      END IF;
      v_expected := public.machine_cash_expected_cents(p_machine_id, p_effective_at);
      v_delta := p_final_count_cents - v_expected;
      INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, actor_id, reference_key, metadata)
      VALUES (p_machine_id, 'count_adjustment', v_delta, p_effective_at, p_actor_id,
        'closing-count:' || p_machine_id || ':' || extract(epoch from clock_timestamp())::TEXT,
        jsonb_build_object('expected_before_cents', v_expected, 'physical_count_cents', p_final_count_cents));
      IF p_final_withdrawal_cents <> 0 THEN
        INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, actor_id, reference_key, metadata)
        VALUES (p_machine_id, 'closing_withdrawal', -p_final_withdrawal_cents, p_effective_at, p_actor_id,
          'closing-withdrawal:' || p_machine_id || ':' || extract(epoch from clock_timestamp())::TEXT,
          jsonb_build_object('physical_count_cents', p_final_count_cents));
      END IF;
      UPDATE public.machine_cash_accounts SET anchor_at = p_effective_at, anchor_balance_cents = 0,
        disabled_at = now(), disabled_by = p_actor_id, updated_at = now()
      WHERE machine_id = p_machine_id;
      UPDATE public.machine_cash_alerts SET resolved_at = now(), resolved_by = p_actor_id, resolution_source = 'disabled'
      WHERE machine_id = p_machine_id AND resolved_at IS NULL;
    END IF;
    UPDATE public.machines SET cash_tracking_enabled = false WHERE id = p_machine_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_action_report_cashbox(
  p_report_id UUID,
  p_actor_id UUID,
  p_cashbox JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.service_action_reports%ROWTYPE;
  v_account public.machine_cash_accounts%ROWTYPE;
  v_existing public.service_action_cash_reconciliations%ROWTYPE;
  v_withdrawal BIGINT;
  v_physical BIGINT;
  v_expected BIGINT;
  v_calculated BIGINT;
  v_discrepancy BIGINT;
  v_reason TEXT;
BEGIN
  SELECT * INTO v_existing FROM public.service_action_cash_reconciliations WHERE report_id = p_report_id;
  IF p_cashbox IS NULL THEN
    IF v_existing.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed cash reconciliation cannot be removed'; END IF;
    DELETE FROM public.service_action_cash_reconciliations WHERE report_id = p_report_id AND status = 'draft';
    RETURN;
  END IF;
  IF jsonb_typeof(p_cashbox) <> 'object'
    OR COALESCE(p_cashbox->>'withdrawal_cents', '') !~ '^\d+$'
    OR COALESCE(p_cashbox->>'physical_remainder_cents', '') !~ '^\d+$'
  THEN RAISE EXCEPTION 'Invalid cash reconciliation'; END IF;
  v_withdrawal := (p_cashbox->>'withdrawal_cents')::BIGINT;
  v_physical := (p_cashbox->>'physical_remainder_cents')::BIGINT;
  v_reason := NULLIF(btrim(p_cashbox->>'discrepancy_reason'), '');
  SELECT * INTO v_report FROM public.service_action_reports WHERE id = p_report_id FOR UPDATE;
  IF v_report.id IS NULL OR NOT public.cash_actor_can_access_machine(p_actor_id, v_report.machine_id, v_report.occurred_at) THEN
    RAISE EXCEPTION 'Cashbox access denied';
  END IF;
  SELECT * INTO v_account FROM public.machine_cash_accounts WHERE machine_id = v_report.machine_id AND disabled_at IS NULL FOR UPDATE;
  IF v_account.machine_id IS NULL THEN RAISE EXCEPTION 'Cash tracking is not active for this machine'; END IF;
  IF v_report.occurred_at < v_account.anchor_at THEN RAISE EXCEPTION 'Cash reconciliation predates the latest balance anchor'; END IF;

  IF v_existing.status = 'confirmed' THEN
    IF v_existing.withdrawal_cents IS DISTINCT FROM v_withdrawal
      OR v_existing.physical_remainder_cents IS DISTINCT FROM v_physical
      OR v_existing.discrepancy_reason IS DISTINCT FROM v_reason
    THEN RAISE EXCEPTION 'Confirmed cash reconciliation cannot change'; END IF;
    RETURN;
  END IF;

  IF v_report.status = 'draft' THEN
    INSERT INTO public.service_action_cash_reconciliations(
      report_id, machine_id, tenant_id, status, withdrawal_cents, physical_remainder_cents, discrepancy_reason, recorded_by
    ) VALUES (
      v_report.id, v_report.machine_id, v_report.tenant_id, 'draft', v_withdrawal, v_physical, v_reason, p_actor_id
    ) ON CONFLICT (report_id) DO UPDATE SET
      withdrawal_cents = EXCLUDED.withdrawal_cents,
      physical_remainder_cents = EXCLUDED.physical_remainder_cents,
      discrepancy_reason = EXCLUDED.discrepancy_reason,
      recorded_by = EXCLUDED.recorded_by,
      updated_at = now();
    RETURN;
  END IF;

  v_expected := public.machine_cash_expected_cents(v_report.machine_id, v_report.occurred_at);
  v_calculated := v_expected - v_withdrawal;
  v_discrepancy := v_physical - v_calculated;
  IF abs(v_discrepancy) >= 1000 AND v_reason IS NULL THEN RAISE EXCEPTION 'A reason is required for cash discrepancies of EUR 10 or more'; END IF;
  INSERT INTO public.service_action_cash_reconciliations(
    report_id, machine_id, tenant_id, status, expected_before_cents, withdrawal_cents,
    calculated_remainder_cents, physical_remainder_cents, discrepancy_cents, discrepancy_reason,
    period_started_at, period_ended_at, recorded_by, confirmed_at
  ) VALUES (
    v_report.id, v_report.machine_id, v_report.tenant_id, 'confirmed', v_expected, v_withdrawal,
    v_calculated, v_physical, v_discrepancy, v_reason,
    v_account.anchor_at, v_report.occurred_at, p_actor_id, now()
  ) ON CONFLICT (report_id) DO UPDATE SET
    status = EXCLUDED.status,
    expected_before_cents = EXCLUDED.expected_before_cents,
    withdrawal_cents = EXCLUDED.withdrawal_cents,
    calculated_remainder_cents = EXCLUDED.calculated_remainder_cents,
    physical_remainder_cents = EXCLUDED.physical_remainder_cents,
    discrepancy_cents = EXCLUDED.discrepancy_cents,
    discrepancy_reason = EXCLUDED.discrepancy_reason,
    period_started_at = EXCLUDED.period_started_at,
    period_ended_at = EXCLUDED.period_ended_at,
    recorded_by = EXCLUDED.recorded_by,
    confirmed_at = EXCLUDED.confirmed_at,
    updated_at = now();

  INSERT INTO public.service_action_cash_orders(report_id, order_id, order_time, contribution_cents, source_snapshot)
  SELECT v_report.id, projection.order_id, projection.order_time, projection.contribution_cents, projection.source_snapshot
  FROM public.machine_cash_order_projections projection
  WHERE projection.machine_id = v_report.machine_id
    AND projection.order_time > v_account.anchor_at AND projection.order_time <= v_report.occurred_at;
  IF v_withdrawal <> 0 THEN
    INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, actor_id, report_id, reference_key, metadata)
    VALUES (v_report.machine_id, 'withdrawal', -v_withdrawal, v_report.occurred_at, p_actor_id, v_report.id,
      'report:' || v_report.id || ':withdrawal', jsonb_build_object('expected_before_cents', v_expected));
  END IF;
  INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, actor_id, report_id, reference_key, metadata)
  VALUES (v_report.machine_id, 'count_adjustment', v_discrepancy, v_report.occurred_at, p_actor_id, v_report.id,
    'report:' || v_report.id || ':count', jsonb_build_object('calculated_remainder_cents', v_calculated, 'physical_remainder_cents', v_physical, 'reason', v_reason));
  UPDATE public.machine_cash_accounts SET
    anchor_at = v_report.occurred_at,
    anchor_balance_cents = v_physical,
    last_collection_at = CASE WHEN v_withdrawal > 0 THEN v_report.occurred_at ELSE last_collection_at END,
    updated_at = now()
  WHERE machine_id = v_report.machine_id;
  UPDATE public.machine_cash_alerts SET resolved_at = now(), resolution_source = 'reconciliation'
  WHERE machine_id = v_report.machine_id AND alert_type = 'collection_overdue' AND resolved_at IS NULL;
  IF abs(v_discrepancy) >= 1000 THEN
    INSERT INTO public.machine_cash_alerts(
      machine_id, alert_type, severity, title, message, reconciliation_report_id
    ) VALUES (
      v_report.machine_id, 'discrepancy', CASE WHEN abs(v_discrepancy) >= 5000 THEN 'critical' ELSE 'warning' END,
      'Cash count discrepancy',
      'The physical cash count differs from the expected balance by EUR ' || to_char(abs(v_discrepancy) / 100.0, 'FM999999990.00') || '.',
      v_report.id
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_revisioned_service_action_report_v2(
  p_client_uuid UUID,
  p_machine_id UUID,
  p_operator_id UUID,
  p_actor_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_action_modes TEXT[],
  p_status TEXT,
  p_notes TEXT,
  p_cleaning_material_used BOOLEAN,
  p_water_bucket_count INTEGER,
  p_refill_lines JSONB,
  p_source TEXT,
  p_expected_revision INTEGER,
  p_draft_payload JSONB,
  p_cashbox JSONB DEFAULT NULL,
  p_incident_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_result JSONB;
BEGIN
  SELECT public.record_revisioned_service_action_report(
    p_client_uuid, p_machine_id, p_operator_id, p_actor_id, p_occurred_at,
    p_action_modes, p_status, p_notes, p_cleaning_material_used,
    p_water_bucket_count, p_refill_lines, p_source, p_expected_revision,
    p_draft_payload, p_incident_ids
  ) INTO v_result;
  PERFORM public.record_action_report_cashbox((v_result->>'id')::UUID, p_actor_id, p_cashbox);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_cashbox_overdue_alerts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  INSERT INTO public.machine_cash_alerts(machine_id, alert_type, severity, title, message)
  SELECT account.machine_id, 'collection_overdue', 'warning', 'Cash collection overdue',
    'No cash collection has been recorded for at least 8 days.'
  FROM public.machine_cash_accounts account
  JOIN public.machines machine ON machine.id = account.machine_id
  WHERE account.disabled_at IS NULL AND machine.cash_tracking_enabled AND machine.deployed
    AND COALESCE(account.last_collection_at, account.opened_at) <= now() - INTERVAL '8 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.machine_cash_alerts alert
      WHERE alert.machine_id = account.machine_id AND alert.alert_type = 'collection_overdue' AND alert.resolved_at IS NULL
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

DO $$
DECLARE v_job RECORD;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname = 'softlife-cashbox-overdue-hourly' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
  PERFORM cron.schedule('softlife-cashbox-overdue-hourly', '17 * * * *', 'SELECT public.refresh_cashbox_overdue_alerts();');
END $$;

CREATE OR REPLACE FUNCTION public.prevent_cash_audit_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Cash audit records are append-only';
END;
$$;
CREATE TRIGGER machine_cash_ledger_immutable BEFORE UPDATE OR DELETE ON public.machine_cash_ledger
FOR EACH ROW EXECUTE FUNCTION public.prevent_cash_audit_mutation();
CREATE TRIGGER service_action_cash_orders_immutable BEFORE UPDATE OR DELETE ON public.service_action_cash_orders
FOR EACH ROW EXECUTE FUNCTION public.prevent_cash_audit_mutation();

CREATE OR REPLACE FUNCTION public.prevent_confirmed_cash_reconciliation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'confirmed' THEN RAISE EXCEPTION 'Confirmed cash reconciliations are immutable'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
CREATE TRIGGER service_action_cash_reconciliations_immutable
BEFORE UPDATE OR DELETE ON public.service_action_cash_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.prevent_confirmed_cash_reconciliation_mutation();

CREATE OR REPLACE FUNCTION public.bump_cash_access_scope_version()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.cash_access IS DISTINCT FROM NEW.cash_access THEN NEW.scope_version := OLD.scope_version + 1; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_cash_access_scope_version
BEFORE UPDATE OF cash_access ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.bump_cash_access_scope_version();

REVOKE ALL ON FUNCTION public.cash_actor_can_access_machine(UUID, UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.machine_cash_expected_cents(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.configure_machine_cashbox(UUID, BOOLEAN, UUID, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_action_report_cashbox(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_revisioned_service_action_report_v2(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT[], TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, INTEGER, JSONB, JSONB, UUID[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_cashbox_overdue_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cash_actor_can_access_machine(UUID, UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.machine_cash_expected_cents(UUID, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.configure_machine_cashbox(UUID, BOOLEAN, UUID, TIMESTAMPTZ, BIGINT, BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_action_report_cashbox(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_revisioned_service_action_report_v2(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT[], TEXT, TEXT, BOOLEAN, INTEGER, JSONB, TEXT, INTEGER, JSONB, JSONB, UUID[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_cashbox_overdue_alerts() TO service_role;

INSERT INTO public.machine_cash_order_projections(order_id, machine_id, order_time, contribution_cents, projection_status, source_snapshot)
SELECT order_row.id, order_row.machine_id, order_row.order_time, projection.contribution_cents, projection.projection_status, projection.source_snapshot
FROM public.huaxin_orders order_row
CROSS JOIN LATERAL public.cash_order_projection_values(order_row) projection
WHERE order_row.machine_id IS NOT NULL
ON CONFLICT (order_id) DO NOTHING;

INSERT INTO public.machine_cash_ledger(machine_id, entry_type, amount_cents, occurred_at, order_id, reference_key, metadata)
SELECT projection.machine_id, 'cash_sale', projection.contribution_cents, projection.order_time, projection.order_id,
  'order:' || projection.order_id || ':projection:backfill',
  jsonb_build_object('projection_status', projection.projection_status, 'source', projection.source_snapshot, 'backfill', true)
FROM public.machine_cash_order_projections projection
WHERE projection.contribution_cents <> 0
ON CONFLICT (reference_key) DO NOTHING;
