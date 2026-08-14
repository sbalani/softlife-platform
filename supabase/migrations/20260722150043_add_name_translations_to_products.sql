ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name_translations jsonb DEFAULT null;
COMMENT ON COLUMN public.products.name_translations IS 'Multi-language display names, e.g. {"es":"Nata","en":"Cream","cn":"奶油"}. Null = use name field.';;
