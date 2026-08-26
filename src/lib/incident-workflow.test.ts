import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionIncident, incidentAccessFilter, incidentStatusesForView } from "./incident-workflow.ts";

test("incident lifecycle separates active work from resolved history", () => {
  assert.deepEqual(incidentStatusesForView("active"), ["open", "in_progress"]);
  assert.deepEqual(incidentStatusesForView("resolved"), ["resolved", "closed"]);
  assert.equal(canTransitionIncident("open", "in_progress"), true);
  assert.equal(canTransitionIncident("open", "resolved"), true);
  assert.equal(canTransitionIncident("in_progress", "resolved"), true);
  assert.equal(canTransitionIncident("resolved", "open"), true);
  assert.equal(canTransitionIncident("resolved", "in_progress"), false);
});

test("incident access follows ownership, assignment, and individual responsibility", () => {
  assert.equal(incidentAccessFilter({ id: "admin", role: "admin", tenant_id: null }), null);
  assert.equal(incidentAccessFilter({ id: "operator", role: "operator", tenant_id: null }), "assigned_user_id.eq.operator,created_by.eq.operator");
  assert.equal(
    incidentAccessFilter({ id: "person", role: "franchisee", tenant_id: "tenant" }),
    "owning_tenant_id.eq.tenant,assigned_tenant_id.eq.tenant,assigned_user_id.eq.person,created_by.eq.person",
  );
  assert.match(incidentAccessFilter({ id: "person", role: "franchisee", tenant_id: null })!, /00000000-0000/);
});
