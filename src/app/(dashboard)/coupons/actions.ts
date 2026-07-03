"use server";

import { revalidatePath } from "next/cache";
import {
  getConfigFromEnv,
  createCoupon,
  generateCouponCodes,
  getCouponRecords,
  deleteCouponApi,
} from "@/lib/huaxin/client";

export type CouponResult = { ok: boolean; error?: string };

export async function createCouponAction(_prev: CouponResult | null, fd: FormData): Promise<CouponResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  const couponType = String(fd.get("couponType") ?? "0");
  const params: Record<string, string> = {
    couponId: "0",
    couponType,
    couponName: String(fd.get("couponName") ?? ""),
    startTime: String(fd.get("startTime") ?? ""),
    endTime: String(fd.get("endTime") ?? ""),
    validDay: String(fd.get("validDay") ?? "30"),
    totalCount: String(fd.get("totalCount") ?? "0"),
    deviceImeis: String(fd.get("deviceImeis") ?? ""),
    localName: String(fd.get("localName") ?? ""),
  };
  if (couponType === "0") params.content = JSON.stringify({ money: String(fd.get("money") ?? "1") });
  else if (couponType === "1")
    params.content = JSON.stringify({
      amount: String(fd.get("amount") ?? "1"),
      productPosition: String(fd.get("productPosition") ?? "1"),
      productName: String(fd.get("productName") ?? ""),
    });
  else if (couponType === "2") params.content = JSON.stringify({ secondary: String(fd.get("secondary") ?? "1") });

  try {
    const result = await createCoupon(cfg, params);
    if (String(result.code) === "200") {
      revalidatePath("/coupons");
      return { ok: true };
    }
    return { ok: false, error: result.msg ?? "Failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function generateCodes(couponId: string, num: number): Promise<CouponResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  try {
    const result = await generateCouponCodes(cfg, couponId, num);
    if (String(result.code) === "200") return { ok: true };
    return { ok: false, error: result.msg ?? "Failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchRecords(couponId: string): Promise<{ records: unknown[]; error?: string }> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { records: [], error: "Huaxin not configured." };
  try {
    const data = await getCouponRecords(cfg, couponId);
    const records = ((data as Record<string, unknown>)?.list as unknown[]) ?? [];
    return { records };
  } catch (e) {
    return { records: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteCouponAction(couponId: string): Promise<CouponResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  try {
    const result = await deleteCouponApi(cfg, couponId);
    if (String(result.code) === "200") {
      revalidatePath("/coupons");
      return { ok: true };
    }
    return { ok: false, error: result.msg ?? "Failed" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
