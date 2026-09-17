import assert from "node:assert/strict";
import test from "node:test";
import { buildManufacturingStockPreflight } from "./manufacturing-stock-preflight.ts";

test("rounds a fractional unit shortage up to a whole package and preserves residual", () => {
  const result = buildManufacturingStockPreflight({
    warehouses: [{ odoo_warehouse_id: 7, recipes: [{ components: [{ odoo_product_id: 47, stock_total_quantity: 2.36, stock_uom: "Units" }] }] }],
    productStock: [
      { odoo_warehouse_id: 7, odoo_product_id: 47, available_quantity: 1.9 },
      { odoo_warehouse_id: 4, odoo_product_id: 47, available_quantity: 10 },
    ],
    products: [{ odoo_id: 47, name: "Fresa", uom: "Units", uom_rounding: 1, tracking: "lot", package_content_quantity: 1000, package_content_uom: "g" }],
    lotStock: [{ odoo_warehouse_id: 4, odoo_lot_id: 12, available_qty: 3.7, lot_name: "LOT-12", expiration_date: null, odoo_product_id: 47 }],
    sourceWarehouseId: 4,
    observedAt: "2026-09-17T12:00:00Z",
  });
  assert.equal(result.requirements[0].shortage_quantity, 0.46);
  assert.equal(result.requirements[0].transfer_quantity, 1);
  assert.equal(result.requirements[0].expected_residual_quantity, 0.54);
  assert.equal(result.requirements[0].lot_candidates[0].available_quantity, 3);
  assert.equal(result.plan_complete, false);
});

test("reserves central stock needed for manufacturing before proposing outbound transfers", () => {
  const result = buildManufacturingStockPreflight({
    warehouses: [
      { odoo_warehouse_id: 4, recipes: [{ components: [{ odoo_product_id: 47, stock_total_quantity: 8, stock_uom: "Units" }] }] },
      { odoo_warehouse_id: 7, recipes: [{ components: [{ odoo_product_id: 47, stock_total_quantity: 5, stock_uom: "Units" }] }] },
    ],
    productStock: [{ odoo_warehouse_id: 4, odoo_product_id: 47, available_quantity: 10 }],
    products: [{ odoo_id: 47, name: "Fresa", uom: "Units", uom_rounding: 1, tracking: "none", package_content_quantity: 1000, package_content_uom: "g" }],
    lotStock: [], sourceWarehouseId: 4, observedAt: "2026-09-17T12:00:00Z",
  });
  assert.deepEqual(result.uncovered, [{ odoo_product_id: 47, product_name: "Fresa", required_quantity: 5, available_quantity: 2 }]);
});
