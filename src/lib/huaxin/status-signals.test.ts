import assert from "node:assert/strict";
import test from "node:test";
import { faultStatusSignal, isCompleteHuaxinStatusPayload, operatingStatusSignals } from "./status-signals.ts";

test("compressor overheat is exposed as an actionable machine signal", () => {
  assert.deepEqual(faultStatusSignal({ code: "status_0_overhot", value: "Abrir" })?.field, "compressor_overheat");
  assert.equal(faultStatusSignal({ code: "status_0_overhot", value: "Abrir" })?.active, true);
  assert.equal(faultStatusSignal({ code: "status_0_overhot", value: "Cierre" })?.active, false);
});

test("remote-control state during defrost is operational, not a fault", () => {
  const signals = operatingStatusSignals({ code: "status_0_os", value: "[4]Control remoto" });
  assert.ok(signals.every((signal) => !signal.active));
  assert.equal(faultStatusSignal({ code: "status_0_os", value: "[4]Control remoto" })?.active, false);
  assert.equal(faultStatusSignal({ code: "status_0_os", value: "[999]Unknown" })?.active, true);
});

test("authoritative status writes require a complete online or offline payload", () => {
  assert.equal(isCompleteHuaxinStatusPayload([{ code: "status_0_online_status", value: "offline" }]), true);
  assert.equal(isCompleteHuaxinStatusPayload([{ code: "status_0_online_status", value: "online" }]), false);
  assert.equal(isCompleteHuaxinStatusPayload([
    { code: "status_0_online_status", value: "online" },
    { code: "status_0_os", value: "Normal" },
    ...Array.from({ length: 8 }, (_, index) => ({ code: `status_${index}`, value: "Normal" })),
  ]), true);
});
