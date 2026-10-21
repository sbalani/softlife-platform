CREATE OR REPLACE FUNCTION public.queue_fiscal_invoice_sale_links(
  p_requested_by UUID, p_payload JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request_id UUID;
  v_expected INTEGER;
  v_matched INTEGER;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object'
    OR p_payload->>'contract_version' <> '1'
    OR p_payload->>'local_month' !~ '^\d{4}-(0[1-9]|1[0-2])$'
    OR jsonb_typeof(p_payload->'links') <> 'array'
    OR jsonb_array_length(p_payload->'links') NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A valid fiscal sale-link payload is required';
  END IF;
  v_expected := jsonb_array_length(p_payload->'links');
  IF (SELECT count(DISTINCT link->>'platform_invoice_id') FROM jsonb_array_elements(p_payload->'links') link) <> v_expected
    OR (SELECT count(DISTINCT link->>'odoo_move_id') FROM jsonb_array_elements(p_payload->'links') link) <> v_expected THEN
    RAISE EXCEPTION 'Fiscal sale-link identities must be unique';
  END IF;

  SELECT count(*) INTO v_matched
  FROM jsonb_to_recordset(p_payload->'links') AS link(
    platform_invoice_id UUID, odoo_move_id INTEGER, source_order_id UUID,
    export_id UUID, recipe_version_id UUID, odoo_warehouse_id INTEGER,
    odoo_sale_order_id INTEGER, odoo_product_id INTEGER, quantity NUMERIC
  )
  JOIN public.fiscal_invoice_documents document ON document.id = link.platform_invoice_id
    AND document.source_order_id = link.source_order_id
    AND document.odoo_move_id = link.odoo_move_id
    AND document.odoo_product_id = link.odoo_product_id
    AND document.status = 'posted' AND document.sale_link_status IN ('unlinked', 'failed')
    AND (document.invoice_payload->'lines'->0->>'quantity')::numeric = link.quantity
    AND document.invoice_date >= (p_payload->>'local_month' || '-01')::date
    AND document.invoice_date < ((p_payload->>'local_month' || '-01')::date + interval '1 month')
  JOIN public.huaxin_orders source_order ON source_order.id = link.source_order_id
    AND source_order.odoo_warehouse_id_at_sale = link.odoo_warehouse_id
  JOIN public.manufacturing_period_export_orders membership ON membership.order_id = link.source_order_id
    AND membership.export_id = link.export_id
  JOIN public.manufacturing_period_exports export ON export.id = link.export_id AND export.status = 'completed'
  WHERE link.quantity > 0 AND link.odoo_move_id > 0 AND link.odoo_warehouse_id > 0
    AND link.odoo_sale_order_id > 0 AND link.odoo_product_id > 0
    AND EXISTS (
      SELECT 1 FROM public.order_product_resolutions resolution
      WHERE resolution.order_id = link.source_order_id
        AND resolution.resolution_status = 'resolved'
        AND resolution.recipe_version_id = link.recipe_version_id
    )
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(export.odoo_result->'warehouses', '[]'::jsonb)) warehouse
      WHERE (warehouse->>'odoo_warehouse_id')::integer = link.odoo_warehouse_id
        AND (warehouse->>'sales_order_id')::integer = link.odoo_sale_order_id
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(export.payload->'warehouses', '[]'::jsonb)) payload_warehouse,
        jsonb_array_elements(COALESCE(payload_warehouse->'recipes', '[]'::jsonb)) recipe
      WHERE (payload_warehouse->>'odoo_warehouse_id')::integer = link.odoo_warehouse_id
        AND recipe->>'recipe_version_id' = link.recipe_version_id::text
        AND (
          (recipe->>'odoo_finished_product_id')::integer = link.odoo_product_id
          OR (recipe->>'odoo_finished_product_id' IS NULL AND EXISTS (
            SELECT 1 FROM public.recipe_versions version
            JOIN public.recipes current_recipe ON current_recipe.id = version.recipe_id
            WHERE version.id = link.recipe_version_id
              AND current_recipe.id::text = recipe->>'recipe_id'
              AND current_recipe.odoo_finished_product_id = link.odoo_product_id
              AND version.odoo_bom_id > 0
          ))
        )
    );
  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'Fiscal sale-link payload does not match posted invoices and completed production exports';
  END IF;

  INSERT INTO public.odoo_sync_requests(kind, requested_by, payload, payload_sha256)
  VALUES ('fiscal_invoice_sale_link', p_requested_by, p_payload, NULL)
  RETURNING id INTO v_request_id;

  UPDATE public.fiscal_invoice_documents document SET
    sale_link_status = 'pending', sale_link_request_id = v_request_id, sale_link_error = NULL
  FROM jsonb_to_recordset(p_payload->'links') AS link(platform_invoice_id UUID)
  WHERE document.id = link.platform_invoice_id AND document.sale_link_status IN ('unlinked', 'failed');
  GET DIAGNOSTICS v_matched = ROW_COUNT;
  IF v_matched <> v_expected THEN RAISE EXCEPTION 'Fiscal sale-link source changed while queueing'; END IF;
  RETURN jsonb_build_object('request_id', v_request_id, 'document_count', v_expected);
END;
$$;

REVOKE ALL ON FUNCTION public.queue_fiscal_invoice_sale_links(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.queue_fiscal_invoice_sale_links(UUID, JSONB) TO service_role;
