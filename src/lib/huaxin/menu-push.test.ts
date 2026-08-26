import assert from "node:assert/strict";
import test from "node:test";
import { huaxinMutationError } from "./client.ts";

test("Huaxin mutation validation rejects transport-success application failures", () => {
  assert.equal(huaxinMutationError({ code: 200, result: false }), "Huaxin did not apply the update");
  assert.equal(huaxinMutationError({ code: 200, data: { result: false }, msg: "device rejected" }), "device rejected");
  assert.equal(huaxinMutationError({ code: 500, msg: "bad request" }), "bad request");
  assert.equal(huaxinMutationError({ code: 200, result: true }), null);
});
