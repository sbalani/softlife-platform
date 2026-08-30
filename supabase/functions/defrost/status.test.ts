import assert from "node:assert/strict";
import test from "node:test";
import { cupAnomalyReason } from "./status.ts";

test("detects cup resource, mechanism, and operating-state anomalies", () => {
  assert.match(cupAnomalyReason([{ code: "status_0_cuplack", value: "Anomalías", data: "1" }]) ?? "", /cuplack/);
  assert.match(cupAnomalyReason([{ code: "status_0_cupfault", value: "Blocked" }]) ?? "", /cupfault/);
  assert.match(cupAnomalyReason([{ code: "status_0_os", value: "[104]Cup take fault" }]) ?? "", /\[104]/);
});

test("does not flag normal cup statuses", () => {
  assert.equal(cupAnomalyReason([
    { code: "status_0_cuplack", value: "Normal", data: "0" },
    { code: "status_0_faultcup", value: "Normal" },
    { code: "status_0_cupfault", value: "Normal" },
    { code: "status_0_cupget", value: "Normal" },
    { code: "status_0_os", value: "[4]Control remoto" },
  ]), null);
  assert.equal(cupAnomalyReason([{ code: "status_0_cuplack", value: "Available" }]), null);
  assert.equal(cupAnomalyReason([{ code: "status_0_cuplack", value: "Normal", data: "1" }]), null);
});
