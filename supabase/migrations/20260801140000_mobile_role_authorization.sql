CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employer_kind TEXT NOT NULL DEFAULT 'softlife',
  ADD COLUMN IF NOT EXISTS scope_version INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'operator', 'franchisee'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_employer_kind_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_employer_kind_check CHECK (employer_kind IN ('softlife', 'franchisee', 'contractor'));
  END IF;
END $$;

UPDATE public.profiles
SET employer_kind = CASE
  WHEN role = 'franchisee' THEN 'franchisee'
  WHEN tenant_id IS NULL THEN 'softlife'
  ELSE 'contractor'
END;

CREATE TABLE IF NOT EXISTS public.user_machine_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  machine_id UUID NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  start_date DATE NOT NULL DEFAULT current_date,
  end_date DATE,
  assigned_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  EXCLUDE USING gist (
    user_id WITH =,
    machine_id WITH =,
    daterange(start_date, COALESCE(end_date, 'infinity'::date), '[]') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS user_machine_assignments_user_dates_idx
  ON public.user_machine_assignments(user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS user_machine_assignments_machine_dates_idx
  ON public.user_machine_assignments(machine_id, start_date, end_date);

ALTER TABLE public.user_machine_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_machine_assignments_read ON public.user_machine_assignments
  FOR SELECT USING (user_id = auth.uid() OR public.is_current_admin());
CREATE POLICY user_machine_assignments_admin_insert ON public.user_machine_assignments
  FOR INSERT WITH CHECK (public.is_current_admin());
CREATE POLICY user_machine_assignments_admin_update ON public.user_machine_assignments
  FOR UPDATE USING (public.is_current_admin()) WITH CHECK (public.is_current_admin());
CREATE POLICY user_machine_assignments_admin_delete ON public.user_machine_assignments
  FOR DELETE USING (public.is_current_admin());

CREATE OR REPLACE FUNCTION public.bump_assignment_scope_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.profiles SET scope_version = scope_version + 1 WHERE id = OLD.user_id;
    RETURN OLD;
  END IF;
  UPDATE public.profiles SET scope_version = scope_version + 1 WHERE id = NEW.user_id;
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    UPDATE public.profiles SET scope_version = scope_version + 1 WHERE id = OLD.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_machine_assignments_scope_version ON public.user_machine_assignments;
CREATE TRIGGER user_machine_assignments_scope_version
AFTER INSERT OR UPDATE OR DELETE ON public.user_machine_assignments
FOR EACH ROW EXECUTE FUNCTION public.bump_assignment_scope_version();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT := COALESCE(new.raw_user_meta_data->>'role', 'operator');
  v_employer TEXT := COALESCE(new.raw_user_meta_data->>'employer_kind', 'softlife');
  v_tenant UUID;
BEGIN
  IF v_role NOT IN ('admin', 'operator', 'franchisee') THEN v_role := 'operator'; END IF;
  IF v_employer NOT IN ('softlife', 'franchisee', 'contractor') THEN v_employer := 'softlife'; END IF;
  BEGIN v_tenant := NULLIF(new.raw_user_meta_data->>'tenant_id', '')::UUID; EXCEPTION WHEN invalid_text_representation THEN v_tenant := NULL; END;
  INSERT INTO public.profiles (id, full_name, email, role, employer_kind, tenant_id)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', new.email),
    new.email,
    v_role,
    v_employer,
    v_tenant
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;
