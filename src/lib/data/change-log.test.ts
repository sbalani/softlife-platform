import assert from "node:assert/strict";
import test from "node:test";
import { alertStatusSignals, diffSnapshots, menuProductIdMap, menuSnapshot } from "./change-log.ts";

test("machine snapshots report field-level menu changes", () => {
  const before = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", price: "3", imagePath: "old.jpg" }], unify: [] });
  const after = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", price: "4", imagePath: "new.jpg" }], unify: [] });

  assert.deepEqual(diffSnapshots(before, after), [
    { entityKey: "diy:1", field: "price", oldValue: "3", newValue: "4" },
    { entityKey: "diy:1", field: "imagePath", oldValue: "old.jpg", newValue: "new.jpg" },
  ]);
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
