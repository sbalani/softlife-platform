CREATE OR REPLACE FUNCTION public.temperature_history(
  p_machine_id UUID,
  p_series_name TEXT,
  p_start TIMESTAMPTZ,
  p_end TIMESTAMPTZ,
  p_detail TEXT DEFAULT '1h',
  p_filter TEXT DEFAULT 'all',
  p_lower DOUBLE PRECISION DEFAULT NULL,
  p_upper DOUBLE PRECISION DEFAULT NULL,
  p_limit INTEGER DEFAULT 250,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  bucket_start TIMESTAMPTZ,
  bucket_end TIMESTAMPTZ,
  value_avg DOUBLE PRECISION,
  value_min DOUBLE PRECISION,
  value_max DOUBLE PRECISION,
  samples BIGINT,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bucket_width INTERVAL;
BEGIN
  IF NOT public.is_current_admin() THEN
    RAISE EXCEPTION 'administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_machine_id IS NULL OR p_series_name IS NULL OR length(p_series_name) = 0 OR length(p_series_name) > 200 THEN
    RAISE EXCEPTION 'invalid machine or series';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_start >= p_end OR p_end - p_start > INTERVAL '366 days' THEN
    RAISE EXCEPTION 'invalid temperature date range';
  END IF;
  IF p_detail NOT IN ('raw', '15m', '1h', '1d') OR p_filter NOT IN ('all', 'outside-range', 'at-or-above', 'at-or-below') THEN
    RAISE EXCEPTION 'invalid temperature detail or filter';
  END IF;
  IF p_limit < 1 OR p_limit > 250 OR p_offset < 0 OR p_offset > 25000000 THEN
    RAISE EXCEPTION 'invalid pagination';
  END IF;
  IF (p_lower IS NOT NULL AND p_lower IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION))
     OR (p_upper IS NOT NULL AND p_upper IN ('NaN'::DOUBLE PRECISION, 'Infinity'::DOUBLE PRECISION, '-Infinity'::DOUBLE PRECISION)) THEN
    RAISE EXCEPTION 'thresholds must be finite';
  END IF;
  IF p_filter = 'outside-range' AND (p_lower IS NULL OR p_upper IS NULL OR p_lower >= p_upper) THEN
    RAISE EXCEPTION 'outside range requires ordered thresholds';
  ELSIF p_filter = 'at-or-above' AND p_lower IS NULL THEN
    RAISE EXCEPTION 'lower threshold required';
  ELSIF p_filter = 'at-or-below' AND p_upper IS NULL THEN
    RAISE EXCEPTION 'upper threshold required';
  END IF;

  bucket_width := CASE p_detail WHEN '15m' THEN INTERVAL '15 minutes' WHEN '1h' THEN INTERVAL '1 hour' ELSE INTERVAL '1 day' END;

  RETURN QUERY
  WITH scoped AS (
    SELECT
      CASE WHEN p_detail = 'raw' THEN temperature.reading_time
           ELSE date_bin(bucket_width, temperature.reading_time, TIMESTAMPTZ '2000-01-01 00:00:00+00') END AS starts_at,
      temperature.reading_time,
      temperature.value
    FROM public.huaxin_temperatures temperature
    WHERE temperature.machine_id = p_machine_id
      AND temperature.series_name = p_series_name
      AND temperature.reading_time >= p_start
      AND temperature.reading_time < p_end
      AND temperature.value IS NOT NULL
  ), aggregated AS (
    SELECT
      starts_at,
      CASE WHEN p_detail = 'raw' THEN max(reading_time) ELSE starts_at + bucket_width END AS ends_at,
      avg(value)::DOUBLE PRECISION AS average_value,
      min(value)::DOUBLE PRECISION AS minimum_value,
      max(value)::DOUBLE PRECISION AS maximum_value,
      count(value)::BIGINT AS sample_count
    FROM scoped
    GROUP BY starts_at
  ), filtered AS (
    SELECT *
    FROM aggregated
    WHERE p_filter = 'all'
       OR (p_filter = 'outside-range' AND (minimum_value < p_lower OR maximum_value > p_upper))
       OR (p_filter = 'at-or-above' AND average_value >= p_lower)
       OR (p_filter = 'at-or-below' AND average_value <= p_upper)
  )
  SELECT
    filtered.starts_at,
    filtered.ends_at,
    filtered.average_value,
    filtered.minimum_value,
    filtered.maximum_value,
    filtered.sample_count,
    count(*) OVER ()::BIGINT
  FROM filtered
  ORDER BY filtered.starts_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.temperature_history(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.temperature_history(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER) TO authenticated;
