import assert from "node:assert/strict";
import test from "node:test";
import { faultStatusSignal } from "./status-signals.ts";

test("compressor overheat is exposed as an actionable machine signal", () => {
  assert.deepEqual(faultStatusSignal({ code: "status_0_overhot", value: "Abrir" })?.field, "compressor_overheat");
  assert.equal(faultStatusSignal({ code: "status_0_overhot", value: "Abrir" })?.active, true);
  assert.equal(faultStatusSignal({ code: "status_0_overhot", value: "Cierre" })?.active, false);
});
