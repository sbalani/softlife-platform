"use server";

import { revalidatePath } from "next/cache";
import {
  getConfigFromEnv,
  createCoupon,
  generateCouponCodes,
  getCouponRecords,
  deleteCouponApi,
} from "@/lib/huaxin/client";
import { couponDaysBetween } from "@/lib/coupon-dates";

export type CouponResult = { ok: boolean; error?: string };

export async function createCouponAction(_prev: CouponResult | null, fd: FormData): Promise<CouponResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  const couponType = String(fd.get("couponType") ?? "0");
  const couponName = String(fd.get("couponName") ?? "").trim();
  const startTime = String(fd.get("startTime") ?? "");
  const endTime = String(fd.get("endTime") ?? "");
  const validDay = Number(fd.get("validDay") ?? 0);
  const totalCount = Number(fd.get("totalCount") ?? 0);
  const deviceImeis = String(fd.get("deviceImeis") ?? "").split(",").map((imei) => imei.trim()).filter(Boolean);
  if (!new Set(["0", "1", "2"]).has(couponType)) return { ok: false, error: "Invalid coupon type." };
  if (!couponName) return { ok: false, error: "Coupon name is required." };
  if (!startTime || !endTime) return { ok: false, error: "Start and end dates are required." };
  if (endTime < startTime) return { ok: false, error: "End date cannot be before start date." };
  if (!Number.isInteger(validDay) || validDay < 1) return { ok: false, error: "Valid days must be at least 1." };
  if (!Number.isInteger(totalCount) || totalCount < 0 || totalCount > 100) return { ok: false, error: "Serial code count must be between 0 and 100." };
  if (couponDaysBetween(startTime, endTime) !== validDay) return { ok: false, error: "End date and valid days do not match." };
  if (deviceImeis.some((imei) => !/^\d{10,20}$/.test(imei))) return { ok: false, error: "Invalid machine selection." };
  const params: Record<string, string> = {
    couponId: "0",
    couponType,
    couponName,
    startTime,
    endTime,
    validDay: String(validDay),
    totalCount: String(totalCount),
    deviceImeis: deviceImeis.join(","),
    localName: String(fd.get("localName") ?? ""),
  };
  if (couponType === "0") {
    const money = Number(fd.get("money") ?? 0);
    if (!Number.isFinite(money) || money <= 0) return { ok: false, error: "Discount amount must be greater than zero." };
    params.content = JSON.stringify({ money: String(money) });
  } else if (couponType === "1") {
    const amount = Number(fd.get("amount") ?? 0);
    const productPosition = String(fd.get("productPosition") ?? "").trim();
    const productName = String(fd.get("productName") ?? "").trim();
    if (!Number.isInteger(amount) || amount < 1 || !productPosition || !productName) return { ok: false, error: "Amount, position, and product name are required." };
    params.content = JSON.stringify({
      amount: String(amount),
      productPosition,
      productName,
    });
  } else {
    const secondary = Number(fd.get("secondary") ?? 0);
    if (!Number.isInteger(secondary) || secondary < 1) return { ok: false, error: "Uses per card must be at least 1." };
    params.content = JSON.stringify({ secondary: String(secondary) });
  }

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
