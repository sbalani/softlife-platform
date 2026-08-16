import assert from "node:assert/strict";
import test from "node:test";
import { MOBILE_CAPABILITIES, hasMobileCapability, normalizeMobileRole } from "./mobile-authorization.ts";

test("mobile roles expose only their operational capabilities", () => {
  assert.equal(normalizeMobileRole("franchisee"), "franchisee");
  assert.equal(normalizeMobileRole("unknown"), "operator");
  assert.equal(MOBILE_CAPABILITIES.operator.includes("remote.basic"), false);
  assert.equal(MOBILE_CAPABILITIES.operator.includes("analytics.read"), true);
  assert.equal(MOBILE_CAPABILITIES.franchisee.includes("service.clean"), true);
  assert.equal(hasMobileCapability({ id: "user", email: null, role: "operator", tenantId: null, employerKind: "softlife", scopeVersion: 1, capabilities: MOBILE_CAPABILITIES.operator }, "service.refill"), true);
});
