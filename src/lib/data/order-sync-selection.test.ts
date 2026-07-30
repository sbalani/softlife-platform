import assert from "node:assert/strict";
import test from "node:test";
import { selectOrderDevices } from "./order-sync-selection.ts";

const devices = [{ deviceImei: "111" }, { deviceImei: "222" }, { deviceImei: "333" }];

test("an empty selection keeps all machines", () => {
  assert.deepEqual(selectOrderDevices(devices, []), { devices, missing: [] });
});

test("one or several selected machines limit the fetch", () => {
  assert.deepEqual(selectOrderDevices(devices, ["111", "333"]), {
    devices: [devices[0], devices[2]],
    missing: [],
  });
  assert.deepEqual(selectOrderDevices(devices, ["999"]).missing, ["999"]);
});
