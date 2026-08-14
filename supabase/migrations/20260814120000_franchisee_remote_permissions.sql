ALTER TABLE public.tenants
  ADD COLUMN remote_commands TEXT[] NOT NULL DEFAULT ARRAY['operate_make']::TEXT[];
