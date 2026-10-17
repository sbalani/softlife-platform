CREATE TABLE public.machine_detail_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  widget_order TEXT[] NOT NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (cardinality(widget_order) > 0)
);

INSERT INTO public.machine_detail_settings (singleton, widget_order)
VALUES (true, ARRAY[
  'monitored_status',
  'hardware_status',
  'recovery_center',
  'service_overview',
  'incidents',
  'pasteurization',
  'temperature',
  'sales',
  'configuration',
  'product_menu',
  'location',
  'service_qr',
  'cleaning_history',
  'lots_traceability',
  'screen_media',
  'branding'
]);

CREATE TRIGGER machine_detail_settings_set_updated_at
BEFORE UPDATE ON public.machine_detail_settings
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.machine_detail_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.machine_detail_settings FROM PUBLIC, anon, authenticated;
