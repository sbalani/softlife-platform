import type { HuaxinCoupon } from "../huaxin/client.ts";

export function aggregateCouponSnapshots(rows: { device_imei: string; coupons: HuaxinCoupon[]; synced_at: string }[]) {
  const coupons = new Map<string, { coupon: HuaxinCoupon; imeis: Set<string> }>();
  for (const row of [...rows].sort((a, b) => a.synced_at.localeCompare(b.synced_at))) {
    for (const coupon of row.coupons) {
      if (!coupon || typeof coupon !== "object") continue;
      const key = String(coupon.couponId ?? `${coupon.couponName}:${coupon.startTime}`);
      const saved = coupons.get(key) ?? { coupon, imeis: new Set<string>() };
      saved.coupon = { ...saved.coupon, ...coupon };
      saved.imeis.add(row.device_imei);
      coupons.set(key, saved);
    }
  }
  return [...coupons.values()].map(({ coupon, imeis }) => ({ ...coupon, deviceImeis: [...imeis].sort().join(",") }));
}
