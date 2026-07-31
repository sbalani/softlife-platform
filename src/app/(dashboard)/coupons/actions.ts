"use server";

import { revalidatePath } from "next/cache";
import {
  getConfigFromEnv,
  createCoupon,
  generateCouponCodes,
  getCouponRecords,
  deleteCouponApi,
  couponApiError,
} from "@/lib/huaxin/client";
import { couponDaysBetween } from "@/lib/coupon-dates";
import { createServiceClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { recordCouponExchange } from "@/lib/data/change-log";
import { refreshCouponSnapshots } from "@/lib/data/coupons";

export type CouponResult = { ok: boolean; error?: string; warning?: string };

async function isAdmin() {
  return (await getSessionProfile())?.role === "admin";
}

export async function createCouponAction(_prev: CouponResult | null, fd: FormData): Promise<CouponResult> {
  if (!await isAdmin()) return { ok: false, error: "Admin access required." };
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  const couponType = String(fd.get("couponType") ?? "0");
  const couponName = String(fd.get("couponName") ?? "").trim();
  const startTime = String(fd.get("startTime") ?? "");
  const endTime = String(fd.get("endTime") ?? "");
  const validDay = Number(fd.get("validDay") ?? 0);
  const totalCount = Number(fd.get("totalCount") ?? 0);
  const deviceImeis = String(fd.get("deviceImeis") ?? "").split(",").map((imei) => imei.trim()).filter(Boolean);
  if (!new Set(["0", "1"]).has(couponType)) return { ok: false, error: "Invalid coupon type." };
  if (!couponName) return { ok: false, error: "Coupon name is required." };
  if (!startTime || !endTime) return { ok: false, error: "Start and end dates are required." };
  if (endTime < startTime) return { ok: false, error: "End date cannot be before start date." };
  if (!Number.isInteger(validDay) || validDay < 1) return { ok: false, error: "Valid days must be at least 1." };
  if (!Number.isInteger(totalCount) || totalCount < 0 || totalCount > 100) return { ok: false, error: "Serial code count must be between 0 and 100." };
  if (couponDaysBetween(startTime, endTime) !== validDay) return { ok: false, error: "End date and valid days do not match." };
  if (deviceImeis.some((imei) => !/^\d{10,20}$/.test(imei))) return { ok: false, error: "Invalid machine selection." };
  if (!deviceImeis.length) return { ok: false, error: "Select at least one machine." };
  let selectedMachines: { device_imei: string }[] = [];
  try {
    const { data, error } = await (await createServiceClient()).from("machines").select("device_imei").in("device_imei", deviceImeis);
    if (error) return { ok: false, error: `Could not validate machine selection: ${error.message}` };
    selectedMachines = (data as { device_imei: string }[]) ?? [];
  } catch (error) {
    return { ok: false, error: `Could not validate machine selection: ${error instanceof Error ? error.message : String(error)}` };
  }
  const storedImeis = new Set(((selectedMachines as { device_imei: string }[]) ?? []).map((machine) => machine.device_imei));
  const missingImeis = deviceImeis.filter((imei) => !storedImeis.has(imei));
  if (missingImeis.length) return { ok: false, error: `Unknown machine selection: ${missingImeis.join(", ")}` };
  const localName = String(fd.get("localName") ?? "").trim();
  if (!localName) return { ok: false, error: "Location label is required." };
  const params: Record<string, string> = {
    couponId: "0",
    couponType,
    couponName,
    startTime: `${startTime} 00:00:00`,
    endTime: `${endTime} 23:59:59`,
    validDay: String(validDay),
    totalCount: String(totalCount),
    deviceImeis: deviceImeis.join(","),
    localName,
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
  }

  try {
    const result = await createCoupon(cfg, params);
    await logCouponExchange("edit", params, result);
    const error = couponApiError(result);
    if (!error) {
      const warning = await refreshCouponSnapshots();
      revalidatePath("/coupons");
      return { ok: true, warning };
    }
    return { ok: false, error };
  } catch (e) {
    await logCouponExchange("edit", params, { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function logCouponExchange(operation: string, request: Record<string, unknown>, response: unknown) {
  try {
    await recordCouponExchange(await createServiceClient(), operation, request, response, await getSessionProfile());
  } catch (error) {
    console.error("[coupons] Could not write API exchange log:", error);
  }
}

export async function generateCodes(couponId: string, num: number): Promise<CouponResult> {
  if (!await isAdmin()) return { ok: false, error: "Admin access required." };
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!Number.isInteger(num) || num < 1 || num > 100) return { ok: false, error: "Serial code count must be between 1 and 100." };
  if (!/^\d+$/.test(couponId) || Number(couponId) < 1) return { ok: false, error: "Invalid coupon ID." };
  try {
    const result = await generateCouponCodes(cfg, couponId, num);
    await logCouponExchange("generate", { couponId, num }, result);
    const error = couponApiError(result);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    await logCouponExchange("generate", { couponId, num }, { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchRecords(couponId: string): Promise<{ records: unknown[]; error?: string }> {
  if (!await isAdmin()) return { records: [], error: "Admin access required." };
  const cfg = getConfigFromEnv();
  if (!cfg) return { records: [], error: "Huaxin not configured." };
  if (!/^\d+$/.test(couponId) || Number(couponId) < 1) return { records: [], error: "Invalid coupon ID." };
  try {
    return { records: await getCouponRecords(cfg, couponId, "") };
  } catch (e) {
    return { records: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteCouponAction(couponId: string): Promise<CouponResult> {
  if (!await isAdmin()) return { ok: false, error: "Admin access required." };
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!/^\d+$/.test(couponId) || Number(couponId) < 1) return { ok: false, error: "Invalid coupon ID." };
  try {
    const result = await deleteCouponApi(cfg, couponId);
    await logCouponExchange("delete", { couponIds: couponId }, result);
    const error = couponApiError(result);
    if (!error) {
      const warning = await refreshCouponSnapshots();
      revalidatePath("/coupons");
      return { ok: true, warning };
    }
    return { ok: false, error };
  } catch (e) {
    await logCouponExchange("delete", { couponIds: couponId }, { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
