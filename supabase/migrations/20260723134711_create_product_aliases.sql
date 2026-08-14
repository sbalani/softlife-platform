CREATE TABLE IF NOT EXISTS public.product_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_aliases_alias_lower_idx
  ON public.product_aliases (LOWER(TRIM(alias)));

ALTER TABLE public.product_aliases ENABLE ROW LEVEL SECURITY;;
