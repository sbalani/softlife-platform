import assert from "node:assert/strict";
import test from "node:test";
import { canAccessWebPath } from "./web-authorization.ts";

test("downloads are available to every authenticated role", () => {
  for (const role of ["admin", "operator", "franchisee"] as const) {
    assert.equal(canAccessWebPath(role, "/downloads"), true);
    assert.equal(canAccessWebPath(role, "/downloads/build-id"), true);
  }
});

test("existing role restrictions remain intact", () => {
  assert.equal(canAccessWebPath("operator", "/refills"), true);
  assert.equal(canAccessWebPath("operator", "/dashboard"), false);
  assert.equal(canAccessWebPath("franchisee", "/analytics"), true);
  assert.equal(canAccessWebPath("franchisee", "/users"), false);
  assert.equal(canAccessWebPath("admin", "/users"), true);
});
