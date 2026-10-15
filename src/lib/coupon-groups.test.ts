import assert from "node:assert/strict";
import test from "node:test";
import { couponCodeIsAvailable, couponGroup, sortCouponGroups } from "./coupon-groups.ts";

const now = Date.parse("2026-10-15T12:00:00Z");

test("coupon availability excludes used, expired, and distributed codes", () => {
  assert.equal(couponCodeIsAvailable({ code: "A", status: "0", expireTime: "2026-10-16 23:59:59", distributed: false, extraInformation: null, metadataRevision: null }, now), true);
  assert.equal(couponCodeIsAvailable({ code: "B", status: "1", distributed: false, extraInformation: null, metadataRevision: null }, now), false);
  assert.equal(couponCodeIsAvailable({ code: "C", status: "0", distributed: true, extraInformation: null, metadataRevision: 1 }, now), false);
});

test("active groups with available codes sort by latest expiry before empty and expired groups", () => {
  const availableSoon = couponGroup({ couponId: 1, couponName: "Soon", endTime: "2026-11-01" }, [{ code: "A", status: "0", distributed: false, extraInformation: null, metadataRevision: null }], now);
  const availableLater = couponGroup({ couponId: 2, couponName: "Later", endTime: "2026-12-01" }, [{ code: "B", status: "0", distributed: false, extraInformation: null, metadataRevision: null }], now);
  const empty = couponGroup({ couponId: 3, couponName: "Empty", endTime: "2027-01-01" }, [], now);
  const expired = couponGroup({ couponId: 4, couponName: "Expired", endTime: "2026-01-01" }, [{ code: "D", status: "0", distributed: false, extraInformation: null, metadataRevision: null }], now);
  const future = couponGroup({ couponId: 5, couponName: "Future", startTime: "2026-11-01", endTime: "2028-01-01" }, [{ code: "E", status: "0", distributed: false, extraInformation: null, metadataRevision: null }], now);
  assert.deepEqual(sortCouponGroups([future, empty, expired, availableSoon, availableLater], now).map((group) => group.couponName), ["Later", "Soon", "Future", "Empty", "Expired"]);
});
