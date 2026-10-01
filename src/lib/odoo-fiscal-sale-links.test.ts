import assert from "node:assert/strict";
import test from "node:test";
import { validateFiscalSaleLinkResult, type FiscalSaleLinkPayload } from "./odoo-fiscal-sale-links.ts";

const payload: FiscalSaleLinkPayload = {
  contract_version: 1,
  local_month: "2026-07",
  links: [{
    platform_invoice_id: "11111111-1111-4111-8111-111111111111",
    odoo_move_id: 10,
    source_order_id: "22222222-2222-4222-8222-222222222222",
    export_id: "33333333-3333-4333-8333-333333333333",
    recipe_version_id: "44444444-4444-4444-8444-444444444444",
    odoo_warehouse_id: 4,
    odoo_sale_order_id: 20,
    odoo_product_id: 30,
    quantity: 1,
  }],
};

test("fiscal sale-link result requires exact Odoo identities", () => {
  assert.doesNotThrow(() => validateFiscalSaleLinkResult(payload, {
    accepted: true,
    links: [{
      platform_invoice_id: payload.links[0].platform_invoice_id,
      odoo_move_id: 10,
      odoo_sale_order_id: 20,
      odoo_sale_order_line_id: 40,
      linked: true,
      already_linked: false,
      sale_order_status: "invoiced",
    }],
  }));
  assert.throws(() => validateFiscalSaleLinkResult(payload, {
    accepted: true,
    links: [{ platform_invoice_id: payload.links[0].platform_invoice_id, odoo_move_id: 11, odoo_sale_order_id: 20, odoo_sale_order_line_id: 40, linked: true, sale_order_status: "invoiced" }],
  }), /identity/);
});

test("failed fiscal sale-link results do not require success rows", () => {
  assert.doesNotThrow(() => validateFiscalSaleLinkResult(payload, { accepted: false, error: "Odoo rejected the manifest" }));
});
