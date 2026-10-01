ALTER TABLE public.franchisee_payout_settlements
  ADD COLUMN agreement_version TEXT,
  ADD COLUMN source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.franchisee_payout_settlements
  DROP CONSTRAINT franchisee_payout_settlements_paid_by_fkey,
  ADD CONSTRAINT franchisee_payout_settlements_paid_by_fkey
    FOREIGN KEY (paid_by) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  ADD CONSTRAINT franchisee_payout_settlements_paid_evidence_check CHECK (
    status = 'pending'
    OR (
      payment_reference IS NOT NULL
      AND char_length(btrim(payment_reference)) > 0
      AND agreement_version IS NOT NULL
      AND char_length(btrim(agreement_version)) > 0
      AND source_snapshot ? 'rows'
      AND source_snapshot ? 'from'
      AND source_snapshot ? 'to'
    )
  );

CREATE OR REPLACE FUNCTION public.protect_paid_franchisee_payout_settlement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'Paid franchisee payout settlements are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_paid_franchisee_payout_settlement
BEFORE UPDATE OR DELETE ON public.franchisee_payout_settlements
FOR EACH ROW EXECUTE FUNCTION public.protect_paid_franchisee_payout_settlement();
