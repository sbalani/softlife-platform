CREATE TABLE public.coupon_code_metadata (
  huaxin_coupon_id TEXT NOT NULL CHECK (huaxin_coupon_id ~ '^[0-9]+$'),
  coupon_code TEXT NOT NULL CHECK (coupon_code = btrim(coupon_code) AND char_length(coupon_code) BETWEEN 1 AND 200),
  distributed BOOLEAN NOT NULL DEFAULT false,
  extra_information TEXT CHECK (extra_information IS NULL OR char_length(extra_information) <= 1000),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (huaxin_coupon_id, coupon_code)
);

ALTER TABLE public.coupon_code_metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_code_metadata FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.coupon_code_metadata TO service_role;
