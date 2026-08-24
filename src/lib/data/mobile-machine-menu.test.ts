import assert from "node:assert/strict";
import test from "node:test";
import { presentMachineMenu } from "./mobile-machine-menu.ts";

test("mobile menu preserves stable identity, localization, values, and explicit mappings", () => {
  const result = presentMachineMenu({
    diy: [{
      position: 2,
      goodsName: "White Chocolate",
      languagePacks: [{ code: "es", goodsName: "Chocolate blanco" }],
      stock: "08",
      enable: 1,
      price: "0.50",
      marketPrice: "0.75",
      imagePath: "https://example.com/product.png",
      allergyPath: "https://example.com/allergens.png",
    }],
    unify: [{ position: 7, goodsName: "Small cup", stock: 0, enable: 0 }],
  }, "2026-08-24T10:00:00.000Z", { "2": "product-2" }, Date.parse("2026-08-24T11:00:00.000Z"));

  assert.deepEqual(result.snapshot, { status: "fresh", synced_at: "2026-08-24T10:00:00.000Z", age_seconds: 3600 });
  assert.deepEqual(result.menu.diy[0], {
    id: "diy:2",
    kind: "diy",
    position: "2",
    name: { default: "White Chocolate", translations: { es: "Chocolate blanco" } },
    stock: 8,
    enabled: true,
    price: "0.50",
    market_price: "0.75",
    image_url: "https://example.com/product.png",
    allergen_url: "https://example.com/allergens.png",
    platform_product_id: "product-2",
  });
  assert.equal(result.menu.unify[0].platform_product_id, null);
  assert.equal(result.menu.unify[0].enabled, false);
});

test("mobile menu reports missing and stale snapshots without fabricating data", () => {
  assert.deepEqual(presentMachineMenu(null, null, {}), {
    snapshot: { status: "missing", synced_at: null, age_seconds: null },
    menu: { diy: [], unify: [] },
  });
  assert.equal(presentMachineMenu({ diy: [], unify: [] }, "2026-08-23T08:59:59.000Z", {}, Date.parse("2026-08-24T11:00:00.000Z")).snapshot.status, "stale");
});
