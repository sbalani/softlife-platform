import assert from "node:assert/strict";
import test from "node:test";
import { canAccessWebPath, isPublicWebPath } from "./web-authorization.ts";

test("public signup does not expose private franchisee administration", () => {
  assert.equal(isPublicWebPath("/franchisee-intake"), true);
  assert.equal(isPublicWebPath("/api/franchisee-intake-contract/79b69771-6d3c-43fd-b068-d11e2b2fa9dc"), true);
  assert.equal(isPublicWebPath("/franchisee-signup"), true);
  assert.equal(isPublicWebPath("/franchisees"), false);
  assert.equal(isPublicWebPath("/users"), false);
});

test("the permanent customer incident form is public without opening internal incidents", () => {
  assert.equal(isPublicWebPath("/report-incident"), true);
  assert.equal(isPublicWebPath("/report-incident/machine-token"), false);
  assert.equal(isPublicWebPath("/incidents"), false);
});

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
  assert.equal(canAccessWebPath("franchisee", "/payouts"), true);
  assert.equal(canAccessWebPath("franchisee", "/orders"), true);
  assert.equal(canAccessWebPath("franchisee", "/orders/history"), true);
  assert.equal(canAccessWebPath("operator", "/orders"), false);
  assert.equal(canAccessWebPath("franchisee", "/incidents"), true);
  assert.equal(canAccessWebPath("franchisee", "/refills"), true);
  assert.equal(canAccessWebPath("franchisee", "/account"), true);
  assert.equal(canAccessWebPath("operator", "/account"), false);
  assert.equal(canAccessWebPath("operator", "/payouts"), false);
  assert.equal(canAccessWebPath("operator", "/incidents"), true);
  assert.equal(canAccessWebPath("franchisee", "/users"), false);
  assert.equal(canAccessWebPath("admin", "/users"), true);
});
