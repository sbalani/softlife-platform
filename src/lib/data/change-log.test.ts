import assert from "node:assert/strict";
import test from "node:test";
import { alertStatusSignals, diffSnapshots, menuFromSnapshot, menuProductIdMap, menuSnapshot } from "./change-log.ts";
import { faultStatusSignal, resourceStatusSignal, statusDisplayRank } from "../huaxin/status-signals.ts";

test("machine snapshots report field-level menu changes", () => {
  const before = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", price: "3", imagePath: "old.jpg" }], unify: [] });
  const after = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", price: "4", imagePath: "new.jpg" }], unify: [] });

  assert.deepEqual(diffSnapshots(before, after), [
    { entityKey: "diy:1", field: "price", oldValue: "3", newValue: "4" },
    { entityKey: "diy:1", field: "imagePath", oldValue: "old.jpg", newValue: "new.jpg" },
  ]);
});

test("stored menu snapshots reconstruct editable Huaxin items", () => {
  const menu = menuFromSnapshot(menuSnapshot({
    diy: [{ position: 2, goodsName: "Vanilla", price: "4", languagePacks: [{ code: "es", goodsName: "Vainilla", intro: "Suave" }] }],
    unify: [{ position: 1, goodsName: "Combo" }],
  }));
  assert.equal(menu.diy[0].position, 2);
  assert.equal(menu.diy[0].price, "4");
  assert.deepEqual(menu.diy[0].languagePacks, [{ code: "es", goodsName: "Vainilla", intro: "Suave" }]);
  assert.equal(menu.unify[0].goodsName, "Combo");
});

test("Huaxin status codes become stable alert signals", () => {
  assert.deepEqual(alertStatusSignals([
    { code: "status_0_cuplack", data: "0", value: "Normal" },
    { code: "status_0_lackmaterial", data: "21", value: "Starts lacking material" },
    { code: "status_0_online_status", value: "online" },
  ]).map(({ field, value }) => ({ field, value })), [
    { field: "cup_empty", value: false },
    { field: "material_empty", value: true },
    { field: "device_online", value: true },
  ]);
});

test("only confirmed cup and material OOS signals become active", () => {
  assert.equal(resourceStatusSignal({ code: "status_0_cuplack", data: "1" })?.active, true);
  assert.equal(resourceStatusSignal({ code: "status_0_cuplack", data: "00" })?.active, false);
  assert.equal(resourceStatusSignal({ code: "status_0_lackmaterial", data: 99, value: "Normal" })?.active, true);
  assert.equal(resourceStatusSignal({ code: "status_0_lackmaterial", data: "0" })?.active, false);
  assert.equal(resourceStatusSignal({ code: "status_0_lackmaterial", value: "unknown" })?.active, false);
  assert.equal(resourceStatusSignal({ code: "other", desc: "Material Level", value: "0" }), null);
  assert.deepEqual(alertStatusSignals([
    { code: "status_0_lackmaterial", data: "0" },
    { code: "status_0_lackmaterial", data: "17" },
  ]).map(({ field, value }) => ({ field, value })), [{ field: "material_empty", value: true }]);
});

test("fault statuses and display order use Huaxin codes", () => {
  assert.equal(faultStatusSignal({ code: "status_0_faultcup", value: "Normal" })?.active, false);
  assert.equal(faultStatusSignal({ code: "status_0_os", value: "Cierre" })?.active, false);
  assert.equal(faultStatusSignal({ code: "status_0_os", value: "正常" })?.active, false);
  assert.equal(faultStatusSignal({ code: "status_0_faultcup", value: "Foreign object" })?.active, true);
  assert.ok(statusDisplayRank({ code: "status_0_lackmaterial" }) < statusDisplayRank({ code: "status_0_online_status" }));
  assert.ok(statusDisplayRank({ code: "status_0_online_status" }) < statusDisplayRank({ code: "status_0_os" }));
  assert.ok(statusDisplayRank({ code: "status_0_os" }) < statusDisplayRank({ code: "status_0_sellcup" }));
});

test("menu events use the currently observed product assignment", () => {
  const ids = menuProductIdMap({
    diy: [{ position: 2, goodsName: "New Product" }],
    unify: [],
  }, [
    { id: "old", name: "Old Product" },
    { id: "new", name: "New Product" },
  ]);
  assert.equal(ids.get("2"), "new");
});
