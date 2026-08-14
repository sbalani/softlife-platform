import assert from "node:assert/strict";
import test from "node:test";
import { alertStatusSignals, diffSnapshots, menuFromSnapshot, menuProductIdMap, menuSnapshot } from "./change-log.ts";
import { faultStatusSignal, materialRemainingStatus, operatingStatusSignals, resourceStatusSignal, statusDisplayRank } from "../huaxin/status-signals.ts";
import { FRANCHISEE_REMOTE_COMMANDS, HUAXIN_REMOTE_COMMANDS } from "../huaxin/remote-commands.ts";

test("machine snapshots report field-level menu changes", () => {
  const before = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", price: "3", imagePath: "old.jpg" }], unify: [] });
  const after = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", price: "4", imagePath: "new.jpg" }], unify: [] });

  assert.deepEqual(diffSnapshots(before, after), [
    { entityKey: "diy:1", field: "price", oldValue: "3", newValue: "4" },
    { entityKey: "diy:1", field: "imagePath", oldValue: "old.jpg", newValue: "new.jpg" },
  ]);
});

test("machine snapshots preserve zero stock for alert evaluation", () => {
  const before = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", stock: 1 }], unify: [] });
  const after = menuSnapshot({ diy: [{ position: 1, goodsName: "Vanilla", stock: 0 }], unify: [] });
  assert.equal(after["diy:1"].stock, 0);
  assert.deepEqual(diffSnapshots(before, after), [
    { entityKey: "diy:1", field: "stock", oldValue: 1, newValue: 0 },
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

test("explicit normal resource states override auxiliary numeric data", () => {
  assert.equal(resourceStatusSignal({ code: "status_0_cuplack", data: "1" })?.active, true);
  assert.equal(resourceStatusSignal({ code: "status_0_cuplack", data: "00" })?.active, false);
  assert.equal(resourceStatusSignal({ code: "status_0_lackmaterial", data: 99, value: "Normal" })?.active, false);
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

test("aggregate operating states distinguish modes from actionable faults", () => {
  assert.deepEqual(operatingStatusSignals({ code: "status_0_os", value: "[11]Modo nocturno" }).map(({ field, active }) => ({ field, active })), [
    { field: "ordering_system_fault", active: false },
  ]);
  assert.deepEqual(operatingStatusSignals({ code: "status_0_os", value: "[105]Cooling off" }).map(({ field, active }) => ({ field, active })), [
    { field: "ordering_system_fault", active: false },
  ]);
  assert.deepEqual(operatingStatusSignals({ code: "status_0_os", value: "[104]Not taken away" }).map(({ field, active }) => ({ field, active })), [
    { field: "ordering_system_fault", active: false },
    { field: "cup_take_fault", active: true },
  ]);
  assert.deepEqual(operatingStatusSignals({ code: "status_0_os", value: "[102]Falta total de material" }).map(({ field, active }) => ({ field, active })), [
    { field: "ordering_system_fault", active: false },
    { field: "material_out", active: true },
  ]);
  assert.deepEqual(operatingStatusSignals({ code: "status_0_os", value: "[255]Insufficient proportion" }).map(({ field, active }) => ({ field, active })), [
    { field: "ordering_system_fault", active: false },
    { field: "mixture_ratio_fault", active: true },
  ]);
  assert.equal(faultStatusSignal({ code: "status_0_os", value: "[999]Unknown" })?.field, "ordering_system_fault");
  assert.equal(faultStatusSignal({ code: "status_0_os", value: "[999]Unknown" })?.active, true);
});

test("confirmed aggregate shortages cannot be overwritten by localized resource rows", () => {
  assert.deepEqual(alertStatusSignals([
    { code: "status_0_os", value: "[101]Falta de Tarrina" },
    { code: "status_0_cuplack", value: "Anomalías", data: 1 },
  ]).map(({ field, value }) => ({ field, value })), [
    { field: "ordering_system_fault", value: false },
    { field: "cup_empty", value: true },
  ]);
});

test("post-shortage cup counter uses the configured percentage thresholds", () => {
  assert.deepEqual(materialRemainingStatus({ code: "status_0_sellcup", value: "13[25]" }), {
    active: true, remainingCups: 13, totalCups: 25, remainingPct: 52, level: "normal", outOfStock: false,
  });
  assert.deepEqual(materialRemainingStatus({ code: "status_0_sellcup", value: "Normal[25]" }), {
    active: false, remainingCups: 25, totalCups: 25, remainingPct: 100, level: "normal", outOfStock: false,
  });
  assert.equal(materialRemainingStatus({ code: "status_0_sellcup", value: "12[25]" })?.level, "warning");
  assert.equal(materialRemainingStatus({ code: "status_0_sellcup", data: "5[20]" })?.level, "critical");
  assert.equal(materialRemainingStatus({ code: "status_0_sellcup", value: "0[25]" })?.outOfStock, true);
  assert.equal(materialRemainingStatus({ code: "status_0_sellcup", value: "invalid" }), null);
  assert.deepEqual(alertStatusSignals([
    { code: "status_0_sellcup", value: "6[25]" },
  ]).map(({ field, value }) => ({ field, value })), [
    { field: "material_remaining_pct", value: 24 },
    { field: "material_out", value: false },
  ]);
});

test("remote command catalog covers every documented Huaxin operation", () => {
  assert.equal(HUAXIN_REMOTE_COMMANDS.length, 19);
  assert.deepEqual(new Set(HUAXIN_REMOTE_COMMANDS.map((item) => item.command)), new Set([
    "operate_backorigin", "operate_openrefrigeration", "operate_closerefrigeration",
    "operate_openthawing", "operate_closethawing", "operate_sellout", "operate_onsale",
    "operate_make", "operate_android_setting", "operate_config_set1", "operate_config_set2",
    "operate_status", "operate_refresh_product", "operate_refresh_resource", "operate_switch_two",
    "operate_switch_three", "operate_switch_coupon", "operate_switch_theme", "operate_clearwarn",
  ]));
  assert.ok(FRANCHISEE_REMOTE_COMMANDS.every((item) => item.access === "remote"));
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
