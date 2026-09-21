import assert from "node:assert/strict";
import test from "node:test";
import { resolveAlertHistoryCustomer } from "../alert-history-filter.ts";

const customers = [
  { id: "tenant-benalvending", name: "Benalvending" },
  { id: "tenant-other", name: "Other franchisee" },
];

test("admins can select only known alert-history customers", () => {
  const admin = { role: "admin", tenant_id: null };
  assert.equal(resolveAlertHistoryCustomer(admin, "tenant-benalvending", customers), "tenant-benalvending");
  assert.equal(resolveAlertHistoryCustomer(admin, "unknown", customers), null);
  assert.equal(resolveAlertHistoryCustomer(admin, null, customers), null);
});

test("franchisees are constrained to their own alert history", () => {
  const franchisee = { role: "franchisee", tenant_id: "tenant-benalvending" };
  assert.equal(resolveAlertHistoryCustomer(franchisee, "tenant-other", customers), "tenant-benalvending");
});

test("other roles cannot request customer alert history", () => {
  assert.equal(resolveAlertHistoryCustomer({ role: "operator", tenant_id: null }, "tenant-benalvending", customers), null);
  assert.equal(resolveAlertHistoryCustomer(null, "tenant-benalvending", customers), null);
});
