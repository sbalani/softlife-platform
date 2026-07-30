import { getConfigFromEnv, listCoupons, type HuaxinCoupon } from "@/lib/huaxin/client";

export type Coupon = HuaxinCoupon;

export async function getCoupons(deviceImeis: string[]): Promise<{ coupons: Coupon[]; error?: string }> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { coupons: [], error: "Huaxin is not configured." };
  if (!deviceImeis.length) return { coupons: [], error: "No machine IMEIs are available to query coupons." };
  const coupons = new Map<string, Coupon>();
  const errors: string[] = [];
  for (const imei of deviceImeis) {
    try {
      for (const coupon of await listCoupons(cfg, imei)) {
        const key = String(coupon.couponId ?? `${coupon.couponName}:${coupon.startTime}`);
        const saved = coupons.get(key);
        coupons.set(key, {
          ...saved,
          ...coupon,
          deviceImeis: coupon.deviceImeis || [saved?.deviceImeis, imei].filter(Boolean).join(","),
        });
      }
    } catch (error) {
      errors.push(`${imei}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { coupons: [...coupons.values()], error: errors.length ? `Could not load coupons for ${errors.join("; ")}` : undefined };
}
