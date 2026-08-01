import assert from "node:assert/strict";
import test from "node:test";
import { machineServiceUrl } from "./service-url.ts";

test("machine QR uses a stable HTTPS route", () => {
  assert.equal(machineServiceUrl("machine-id", "https://service.example/"), "https://service.example/machine/machine-id");
  assert.throws(() => machineServiceUrl("machine-id", "http://service.example"), /HTTPS/);
});
