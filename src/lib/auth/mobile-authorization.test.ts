import assert from "node:assert/strict";
import test from "node:test";
import { MOBILE_CAPABILITIES, canDismissMobileAlert, canReceiveMobileAlert, hasMobileCapability, normalizeMobileRole } from "./mobile-authorization.ts";

test("mobile roles expose only their operational capabilities", () => {
  assert.equal(normalizeMobileRole("franchisee"), "franchisee");
  assert.equal(normalizeMobileRole("unknown"), "operator");
  assert.equal(MOBILE_CAPABILITIES.operator.includes("remote.basic"), false);
  assert.equal(MOBILE_CAPABILITIES.operator.includes("analytics.read"), true);
  assert.equal(MOBILE_CAPABILITIES.franchisee.includes("service.clean"), true);
  assert.equal(MOBILE_CAPABILITIES.operator.includes("action_reports.write"), true);
  assert.equal(MOBILE_CAPABILITIES.operator.includes("action_reports.attach"), true);
  assert.equal(hasMobileCapability({ id: "user", email: null, role: "operator", tenantId: null, employerKind: "softlife", scopeVersion: 1, capabilities: MOBILE_CAPABILITIES.operator }, "service.refill"), true);
});

test("mobile alert recipients preserve the admin all-machines scope", () => {
  assert.equal(canReceiveMobileAlert("admin", null, "machine-1"), true);
  assert.equal(canReceiveMobileAlert("operator", ["machine-1"], "machine-1"), true);
  assert.equal(canReceiveMobileAlert("operator", [], "machine-1"), false);
  assert.equal(canReceiveMobileAlert("admin", undefined, "machine-1"), false);
  assert.equal(canReceiveMobileAlert("admin", null, null), true);
  assert.equal(canReceiveMobileAlert("franchisee", ["machine-1"], null), false);
});

test("mobile alert dismissal matches the web role policy", () => {
  const session = (role: "admin" | "operator" | "franchisee") => ({
    id: "user", email: null, role, tenantId: null, employerKind: "softlife" as const,
    scopeVersion: 1, capabilities: MOBILE_CAPABILITIES[role],
  });
  assert.equal(canDismissMobileAlert(session("admin")), true);
  assert.equal(canDismissMobileAlert(session("franchisee")), true);
  assert.equal(canDismissMobileAlert(session("operator")), false);
  assert.equal(canDismissMobileAlert({ ...session("admin"), capabilities: [] }), false);
});
