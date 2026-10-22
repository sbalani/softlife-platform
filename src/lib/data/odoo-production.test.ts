import assert from "node:assert/strict";
import test from "node:test";
import { describeManufacturingPreparationError, manufacturingClaimBody, manufacturingContractVersion, manufacturingGrossCents, manufacturingQueryBatches, manufacturingSourceOrder, mergeRecipeVersionComponents, OdooContractError, parsePeriodInput, presentManufacturingExport, recordManufacturingPeriodResult, validateManufacturingResult, validateManufacturingV3PayloadTotals } from "./odoo-production.ts";
import { sha256 } from "../odoo-sync-contract.ts";

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

test("worker claims reconstruct the original local period across daylight saving time", () => {
  assert.deepEqual(manufacturingClaimBody({
    idempotency_key: "platform:august", period_from: "2026-07-31T22:00:00.000Z",
    period_to: "2026-08-31T22:00:00.000Z", time_zone: "Europe/Madrid", initiated_by: "platform",
  }), {
    idempotency_key: "platform:august", local_from: "2026-08-01T00:00:00",
    local_to: "2026-09-01T00:00:00", time_zone: "Europe/Madrid", initiated_by: "platform",
  });
  assert.deepEqual(manufacturingClaimBody({
    idempotency_key: "odoo:partial-day", period_from: "2026-01-15T07:30:00.000Z",
    period_to: "2026-01-15T10:45:30.000Z", time_zone: "Europe/Madrid", initiated_by: "odoo",
  }), {
    idempotency_key: "odoo:partial-day", local_from: "2026-01-15T08:30:00",
    local_to: "2026-01-15T11:45:30", time_zone: "Europe/Madrid", initiated_by: "odoo",
  });
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

test("manufacturing v3 requires Madrid post-cutover periods and exact transaction SO mappings", () => {
  assert.equal(manufacturingContractVersion({ localFrom: "2026-08-01T00:00:00", localTo: "2026-09-01T00:00:00", timeZone: "Europe/Madrid" }), 2);
  assert.equal(manufacturingContractVersion({ localFrom: "2026-09-01T00:00:00", localTo: "2026-10-01T00:00:00", timeZone: "Europe/Madrid" }), 3);
  assert.throws(() => manufacturingContractVersion({ localFrom: "2026-08-31T00:00:00", localTo: "2026-09-02T00:00:00", timeZone: "Europe/Madrid" }), /cannot cross/);
  const payload = { manufacturing_contract_version: 3, warehouses: [{
    odoo_warehouse_id: 7, recipes: [{ recipe_version_id: "recipe-1", gross_sales: 1.005, gross_sales_cents: 101 }], sales_orders: [{
      platform_order_id: "order-1", platform_line_key: "order-1:1", source_sha256: "a".repeat(64),
      recipe_version_id: "recipe-1", expected_total_cents: 101,
    }],
  }] };
  const result = { accepted: true, warehouses: [{ odoo_warehouse_id: 7, manufacturing_order_ids: [1], sales_orders: [{
    platform_order_id: "order-1", platform_line_key: "order-1:1", source_sha256: "a".repeat(64),
    odoo_sale_order_id: 2, odoo_sale_order_line_id: 3, created: true,
  }] }] };
  assert.doesNotThrow(() => validateManufacturingResult(result, payload));
  assert.throws(() => validateManufacturingResult({ ...result, warehouses: [{ ...result.warehouses[0], sales_orders: [] }] }, payload), /exact/);
  assert.throws(() => validateManufacturingV3PayloadTotals({ ...payload, warehouses: [{
    ...payload.warehouses[0], recipes: [{ ...payload.warehouses[0].recipes[0], gross_sales_cents: 100 }],
  }] }), /per-order rounded/);
});

test("manufacturing responses expose the frozen payload contract version", () => {
  const capabilities = { manufacturing_transaction_sales: 1 };
  const payload = { payload_contract_version: 2, manufacturing_contract_version: 3, connector_capabilities: capabilities, warehouses: [] };
  const payloadHash = sha256(payload);
  const response = presentManufacturingExport({ id: "run", payload, payload_sha256: payloadHash });
  assert.equal(response.payload_contract_version, 2);
  assert.equal(response.manufacturing_contract_version, 3);
  assert.deepEqual(response.connector_capabilities, capabilities);
  assert.equal(response.payload_sha256, payloadHash);
  assert.equal(sha256(payload), payloadHash);
  const historical = presentManufacturingExport({ id: "historical", payload: { warehouses: [] } });
  assert.equal(historical.payload_contract_version, 1);
  assert.equal(historical.manufacturing_contract_version, 1);
  assert.equal(Object.hasOwn(historical, "connector_capabilities"), false);
});

test("manufacturing source references preserve order and machine provenance", () => {
  assert.deepEqual(manufacturingSourceOrder({
    id: "order-id", order_code: "S00124", machine_id: "machine-id", device_imei: "860000000000001",
    machines: { name: "Flowers" },
  }), {
    platform_order_id: "order-id", order_code: "S00124", machine_id: "machine-id",
    machine_imei: "860000000000001", machine_name: "Flowers",
  });
});

test("manufacturing v3 aggregate cents sum per-order rounded gross amounts", () => {
  const prices = ["1.004", "1.005", "2.999"];
  const cents = prices.map(manufacturingGrossCents);
  assert.deepEqual(cents, [100, 101, 300]);
  assert.equal(cents.reduce<number>((sum, value) => sum + (value ?? 0), 0), 501);
  assert.equal(prices.reduce((sum, value) => sum + Number(value), 0), 5.008);

  const sharedProductVersions = { warehouses: [{
    recipes: [
      { recipe_version_id: "recipe-1", odoo_finished_product_id: 101, gross_sales: 1, gross_sales_cents: 100 },
      { recipe_version_id: "recipe-2", odoo_finished_product_id: 101, gross_sales: 2, gross_sales_cents: 200 },
    ],
    sales_orders: [
      { recipe_version_id: "recipe-1", expected_total_cents: 100 },
      { recipe_version_id: "recipe-2", expected_total_cents: 200 },
    ],
  }] };
  assert.doesNotThrow(() => validateManufacturingV3PayloadTotals(sharedProductVersions));
  assert.throws(() => validateManufacturingV3PayloadTotals({ warehouses: [{
    ...sharedProductVersions.warehouses[0],
    sales_orders: [{ recipe_version_id: "recipe-1", expected_total_cents: 300 }],
  }] }), /per-order rounded|exactly one recipe/);
});

test("large manufacturing queries are split into URL-safe batches", () => {
  const values = Array.from({ length: 1001 }, (_, index) => `order-${index}`);
  const batches = manufacturingQueryBatches(values);
  assert.deepEqual(batches.map((batch) => batch.length), [200, 200, 200, 200, 200, 1]);
  assert.deepEqual(batches.flat(), values);
});

test("structured preparation errors remain actionable", () => {
  assert.equal(describeManufacturingPreparationError({
    message: "Request URI is too long", details: "The order filter exceeded the proxy limit", hint: "Send fewer IDs", code: "PGRST000",
  }), "Request URI is too long Details: The order filter exceeded the proxy limit Hint: Send fewer IDs (PGRST000)");
  assert.equal(describeManufacturingPreparationError(new Error("Network unavailable")), "Network unavailable");
});

test("manufacturing callback bounds UTF-8 result bytes", async () => {
  await assert.rejects(recordManufacturingPeriodResult({} as never,
    "11111111-1111-4111-8111-111111111111", {
      payload_sha256: "a".repeat(64), accepted: true, padding: "é".repeat(2_500_001),
    }), /too large/);
});
