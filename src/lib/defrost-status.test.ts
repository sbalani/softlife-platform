import assert from "node:assert/strict";
import test from "node:test";
import { defrostFormationPct, defrostStatusValue, isHuaxinClosed, isHuaxinOpen, isHuaxinSalesBlocked, isHuaxinSalesReady } from "./defrost-status.ts";

const liveTestMachineStatuses = [
  { code: "status_0_ac", value: "Abrir" },
  { code: "status_0_thaw", value: "Cierre" },
  { code: "status_0_percent", value: "100" },
  { code: "status_0_stock", value: "Abrir" },
];

test("recognizes live Spanish and English Huaxin switch values", () => {
  assert.equal(isHuaxinOpen(defrostStatusValue(liveTestMachineStatuses, "status_0_ac")), true);
  assert.equal(isHuaxinClosed(defrostStatusValue(liveTestMachineStatuses, "status_0_thaw")), true);
  assert.equal(isHuaxinOpen("Open"), true);
  assert.equal(isHuaxinClosed("Close"), true);
});

test("distinguishes manual sales blocks from valid normal and night modes", () => {
  assert.equal(isHuaxinSalesBlocked("[9]Cerrado"), true);
  assert.equal(isHuaxinSalesBlocked("[105]Cierre de refrigeración"), true);
  assert.equal(isHuaxinSalesReady("Normal"), true);
  assert.equal(isHuaxinSalesReady("[11]Modo nocturno"), true);
  assert.equal(isHuaxinSalesReady("[9]Cerrado"), false);
});

test("reads the stable formation percentage without accepting invalid values", () => {
  assert.equal(defrostFormationPct(liveTestMachineStatuses), 100);
  assert.equal(defrostFormationPct([{ code: "status_0_percent", value: "42%" }]), 42);
  assert.equal(defrostFormationPct([{ code: "status_0_percent", value: "unknown" }]), null);
});
