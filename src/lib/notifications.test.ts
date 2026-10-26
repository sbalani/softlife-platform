import assert from "node:assert/strict";
import test from "node:test";
import { canAccessNotifications, notificationAmount, safeNotificationHref } from "./notifications.ts";

test("notification access is deliberately limited to admins and franchisees", () => {
  assert.equal(canAccessNotifications("admin"), true);
  assert.equal(canAccessNotifications("franchisee"), true);
  assert.equal(canAccessNotifications("operator"), false);
});

test("notification display helpers keep links internal and amounts exact", () => {
  assert.equal(safeNotificationHref("/payouts"), "/payouts");
  assert.equal(safeNotificationHref("https://example.com"), "/notifications");
  assert.match(notificationAmount({ amountCents: 123456 })!, /1234,56/);
  assert.equal(notificationAmount({ amountCents: 1.5 }), null);
});
