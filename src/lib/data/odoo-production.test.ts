import assert from "node:assert/strict";
import test from "node:test";
import { mergeRecipeVersionComponents, OdooContractError, parsePeriodInput, presentManufacturingExport, validateManufacturingResult } from "./odoo-production.ts";

test("period requests freeze exact UTC boundaries and a deterministic fingerprint", () => {
  const input = parsePeriodInput({
    idempotency_key: "odoo-db:august", local_from: "2026-08-01T00:00:00", local_to: "2026-09-01T00:00:00",
    time_zone: "Europe/Madrid", initiated_by: "odoo",
  });
  assert.equal(input.periodFrom, "2026-07-31T22:00:00.000Z");
  assert.equal(input.periodTo, "2026-08-31T22:00:00.000Z");
  assert.equal(input.documentDate, "2026-08-31");
  assert.equal(input.fingerprint.length, 64);
});

test("period requests reject missing keys and backwards ranges", () => {
  assert.throws(() => parsePeriodInput({ local_from: "2026-08-01T00:00", local_to: "2026-08-02T00:00", time_zone: "UTC" }), OdooContractError);
  assert.throws(() => parsePeriodInput({ idempotency_key: "x", local_from: "2026-08-02T00:00", local_to: "2026-08-01T00:00", time_zone: "UTC", initiated_by: "odoo" }), /after/);
});

test("recipe versions merge direct Odoo packaging in component sequence", () => {
  const components = mergeRecipeVersionComponents([
    { product_id: "11111111-1111-1111-1111-111111111111", odoo_product_id: 41, quantity: 80, uom: "g", sequence: 1 },
    { product_id: "22222222-2222-2222-2222-222222222222", odoo_product_id: 42, quantity: 12, uom: "g", sequence: 2 },
  ], [{ odoo_product_id: 9001, quantity: 1, uom: "unit", sequence: 3 }]);

  assert.deepEqual(components.at(-1), {
    platform_product_id: null, odoo_product_id: 9001, quantity: 1, uom: "unit", sequence: 3,
  });
  assert.equal(components.filter((component) => component.odoo_product_id === 9001).length, 1);
  assert.equal(components[0].odoo_product_id, 41);
});

test("accepted manufacturing results must cover every frozen warehouse", () => {
  const payload = { warehouses: [
    { odoo_warehouse_id: 7, recipes: [{}] },
    { odoo_warehouse_id: 8, recipes: [{}] },
  ] };
  assert.throws(() => validateManufacturingResult({ accepted: true, warehouses: [{ odoo_warehouse_id: 7, manufacturing_order_ids: [1], sales_order_id: 2, delivery_id: 3 }] }, payload), OdooContractError);
  assert.doesNotThrow(() => validateManufacturingResult({ accepted: true, warehouses: [
    { odoo_warehouse_id: 7, manufacturing_order_ids: [1], sales_order_id: 2, delivery_id: 3 },
    { odoo_warehouse_id: 8, manufacturing_order_ids: [4], sales_order_id: 5, delivery_id: 6 },
  ] }, payload));
  assert.throws(() => validateManufacturingResult({ accepted: true, warehouses: [
    { odoo_warehouse_id: 7, manufacturing_order_ids: [1, 1], sales_order_id: 2, delivery_id: 3 },
    { odoo_warehouse_id: 8, manufacturing_order_ids: [4], sales_order_id: 5, delivery_id: 6 },
  ] }, payload), OdooContractError);
  assert.throws(() => validateManufacturingResult({ accepted: true, warehouses: [
    { odoo_warehouse_id: 7, manufacturing_order_ids: [1], sales_order_id: 2, delivery_id: 3 },
    { odoo_warehouse_id: 8, manufacturing_order_ids: [1], sales_order_id: 2, delivery_id: 3 },
  ] }, payload), OdooContractError);
  assert.throws(() => validateManufacturingResult({ accepted: false, error: "" }, payload), OdooContractError);
});

test("manufacturing responses expose the frozen payload contract version", () => {
  const response = presentManufacturingExport({ id: "run", payload: { payload_contract_version: 2, warehouses: [] } });
  assert.equal(response.payload_contract_version, 2);
  assert.equal(presentManufacturingExport({ id: "historical", payload: { warehouses: [] } }).payload_contract_version, 1);
});
