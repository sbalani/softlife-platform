import { getConfigFromEnv, listCoupons, type HuaxinCoupon } from "@/lib/huaxin/client";

export type Coupon = HuaxinCoupon;

export async function getCoupons(): Promise<Coupon[]> {
  const cfg = getConfigFromEnv();
  if (!cfg) return [];
  try {
    return await listCoupons(cfg);
  } catch {
    return [];
  }
}
