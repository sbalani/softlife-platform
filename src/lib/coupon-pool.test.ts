import assert from "node:assert/strict";
import test from "node:test";
import { activeCouponGroups, couponPoolCandidates, mapCouponPoolLeaseRows } from "./coupon-pool.ts";

const now = Date.parse("2026-10-23T12:00:00Z");

test("active coupon groups require a provider ID and a current unexpired window", () => {
  assert.deepEqual(activeCouponGroups([
    { couponId: 1, couponName: "Active", startTime: "2026-10-01", endTime: "2026-10-24" },
    { couponId: 2, couponName: "Future", startTime: "2026-10-24", endTime: "2026-10-25" },
    { couponId: 3, couponName: "Expired", startTime: "2026-10-01", endTime: "2026-10-22" },
    { couponName: "No ID", endTime: "2026-10-24" },
  ], now), [{ couponId: "1", couponName: "Active", groupExpiresAt: "2026-10-24T23:59:59.000Z" }]);
});

test("pool candidates exclude unavailable records and sort by effective expiry then identifiers", () => {
  const groups = activeCouponGroups([
    { couponId: 20, couponName: "Later group", endTime: "2026-10-30" },
    { couponId: 10, couponName: "Soon group", endTime: "2026-10-25" },
  ], now);
  const byId = new Map(groups.map((group) => [group.couponId, group]));
  const candidates = couponPoolCandidates([
    { group: byId.get("20")!, records: [
      { code: "B", status: "0", expireTime: "2026-10-24 12:00:00", distributed: false, extraInformation: "desk", metadataRevision: 2 },
      { code: "USED", status: "1", distributed: false, extraInformation: null, metadataRevision: null },
      { code: "DIST", status: "0", distributed: true, extraInformation: null, metadataRevision: 1 },
      { code: "OLD", status: "0", expireTime: "2026-10-22", distributed: false, extraInformation: null, metadataRevision: null },
    ] },
    { group: byId.get("10")!, records: [
      { code: "A", status: "0", distributed: false, extraInformation: null, metadataRevision: null },
      { code: " C ", status: "0", distributed: false, extraInformation: null, metadataRevision: null },
    ] },
  ], now);

  assert.deepEqual(candidates.map(({ couponId, code }) => ({ couponId, code })), [
    { couponId: "20", code: "B" },
    { couponId: "10", code: "A" },
  ]);
  assert.equal(candidates[0].expireTime, "2026-10-24T12:00:00.000Z");
});

test("lease rows map to the mobile contract without conflating lease and distribution state", () => {
  assert.deepEqual(mapCouponPoolLeaseRows([{
    huaxin_coupon_id: "7",
    coupon_name: "Promo",
    coupon_code: "CODE",
    provider_expires_at: "2026-10-24T12:00:00+00:00",
    lease_token: "b867b107-fd41-4b00-b3a3-05e76d256c3d",
    lease_expires_at: "2026-10-24T11:00:00+00:00",
    extra_information: "Front desk",
    metadata_revision: 4,
  }]), [{
    couponId: "7",
    couponName: "Promo",
    code: "CODE",
    expireTime: "2026-10-24T12:00:00+00:00",
    leaseToken: "b867b107-fd41-4b00-b3a3-05e76d256c3d",
    leaseExpiresAt: "2026-10-24T11:00:00+00:00",
    distributed: false,
    extraInformation: "Front desk",
    metadataRevision: 4,
  }]);
});
