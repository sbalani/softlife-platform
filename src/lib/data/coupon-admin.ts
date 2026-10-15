import { couponDaysBetween } from "@/lib/coupon-dates";
import { buildCouponContent, parseCouponUseCount } from "@/lib/coupon-content";
import { recordCouponExchange } from "@/lib/data/change-log";
import { refreshCouponSnapshots } from "@/lib/data/coupons";
import {
  couponApiError,
  createCoupon,
  deleteCouponApi,
  generateCouponCodes,
  getConfigFromEnv,
} from "@/lib/huaxin/client";
import { createServiceClient } from "@/lib/supabase/server";
import { deleteCouponCodeMetadata, getCouponCodesWithMetadata, updateCouponCodeMetadata } from "@/lib/data/coupon-code-metadata";
import { couponCodeIsAvailable, couponGroup, sortCouponGroups, type CouponGroup } from "@/lib/coupon-groups";
import { getCoupons, type Coupon } from "@/lib/data/coupons";

export type CreateCouponInput = {
  couponType: string;
  couponName: string;
  startTime: string;
  endTime: string;
  validDay: number;
  totalCount: number;
  secondary: number;
  machineIds: string[];
  localName: string;
  money?: number;
  amount?: number;
  productPosition?: string;
  productName?: string;
};

type CouponResult = { ok: boolean; error?: string; warning?: string };
type CouponActor = { id: string; email: string | null };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validCouponId(couponId: string) {
  return /^\d+$/.test(couponId) && Number(couponId) > 0;
}

async function logCoupon(operation: string, request: Record<string, unknown>, response: unknown, actor: CouponActor) {
  try {
    await recordCouponExchange(await createServiceClient(), operation, request, response, actor);
  } catch (error) {
    console.error("[coupons] Could not write mobile API exchange log:", error);
  }
}

export function validateCouponInput(input: CreateCouponInput): string | null {
  if (!new Set(["0", "1"]).has(input.couponType)) return "Invalid coupon type.";
  if (typeof input.couponName !== "string" || !input.couponName.trim()) return "Coupon name is required.";
  if (typeof input.startTime !== "string" || typeof input.endTime !== "string" || !input.startTime || !input.endTime || input.endTime < input.startTime) return "Valid start and end dates are required.";
  if (!Number.isInteger(input.validDay) || input.validDay < 1 || couponDaysBetween(input.startTime, input.endTime) !== input.validDay) return "End date and valid days do not match.";
  if (!Number.isInteger(input.totalCount) || input.totalCount < 0 || input.totalCount > 100) return "Serial code count must be between 0 and 100.";
  if (parseCouponUseCount(String(input.secondary)) === null) return "Uses per code must be a whole number of at least 1.";
  if (!Array.isArray(input.machineIds) || !input.machineIds.length || input.machineIds.some((id) => typeof id !== "string" || !UUID_RE.test(id))) return "Select at least one valid machine.";
  if (typeof input.localName !== "string" || !input.localName.trim()) return "Location label is required.";
  if (input.couponType === "0" && (!Number.isFinite(input.money) || Number(input.money) <= 0)) return "Discount amount must be greater than zero.";
  if (input.couponType === "1" && (!Number.isInteger(input.amount) || Number(input.amount) < 1 || !input.productPosition?.trim() || !input.productName?.trim())) return "Amount, position, and product name are required.";
  return null;
}

export async function createAdminCoupon(input: CreateCouponInput, actor: CouponActor): Promise<CouponResult & { couponId?: string }> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  const validationError = validateCouponInput(input);
  if (validationError) return { ok: false, error: validationError };

  const service = await createServiceClient();
  const { data, error } = await service.from("machines").select("id,device_imei").in("id", input.machineIds);
  if (error) return { ok: false, error: `Could not validate machine selection: ${error.message}` };
  const selected = (data as { id: string; device_imei: string | null }[]) ?? [];
  if (selected.length !== new Set(input.machineIds).size || selected.some((machine) => !machine.device_imei)) return { ok: false, error: "Unknown or unavailable machine selection." };

  const params: Record<string, string> = {
    couponId: "0",
    couponType: input.couponType,
    couponName: input.couponName.trim(),
    startTime: `${input.startTime} 00:00:00`,
    endTime: `${input.endTime} 23:59:59`,
    validDay: String(input.validDay),
    totalCount: String(input.totalCount),
    deviceImeis: selected.map((machine) => machine.device_imei).join(","),
    localName: input.localName.trim(),
  };
  if (input.couponType === "0") {
    params.content = buildCouponContent({ money: String(input.money) }, input.secondary);
  } else {
    params.content = buildCouponContent({ amount: String(input.amount), productPosition: input.productPosition!.trim(), productName: input.productName!.trim() }, input.secondary);
  }

  try {
    const result = await createCoupon(cfg, params);
    await logCoupon("edit", params, result, actor);
    const apiError = couponApiError(result);
    if (apiError) return { ok: false, error: apiError };
    const payload = result.data && typeof result.data === "object" ? result.data as { couponId?: string | number } : null;
    const couponId = payload?.couponId == null ? undefined : String(payload.couponId);
    return { ok: true, warning: await refreshCouponSnapshots(), couponId };
  } catch (error) {
    await logCoupon("edit", params, { error: error instanceof Error ? error.message : String(error) }, actor);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function generateAdminCouponCodes(couponId: string, num: number, actor: CouponActor): Promise<CouponResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!validCouponId(couponId) || !Number.isInteger(num) || num < 1 || num > 100) return { ok: false, error: "Invalid coupon ID or code count." };
  try {
    const result = await generateCouponCodes(cfg, couponId, num);
    await logCoupon("generate", { couponId, num }, result, actor);
    const error = couponApiError(result);
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getAdminCouponCodes(couponId: string) {
  return getCouponCodesWithMetadata(couponId);
}

export async function getAdminCouponGroups(includeRecords = false) {
  const snapshot = await getCoupons();
  if (snapshot.readError) return { ...snapshot, groups: [] as CouponGroup[] };
  const groups = await Promise.all(snapshot.coupons.map(async (coupon) => {
    try {
      const records = coupon.couponId == null ? [] : await getCouponCodesWithMetadata(String(coupon.couponId));
      const summary = couponGroup(coupon, records);
      return includeRecords ? summary : { ...summary, records: undefined };
    } catch (error) {
      return couponGroup(coupon, [], Date.now(), error instanceof Error ? error.message : String(error));
    }
  }));
  return { ...snapshot, groups: sortCouponGroups(groups) };
}

export function resolveCouponGroup(coupons: Coupon[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return { error: "Coupon group is required." } as const;
  const exactId = coupons.filter((coupon) => String(coupon.couponId ?? "") === query.trim());
  if (exactId.length === 1) return { coupon: exactId[0] } as const;
  const exactName = coupons.filter((coupon) => String(coupon.couponName ?? "").trim().toLowerCase() === normalized);
  if (exactName.length === 1) return { coupon: exactName[0] } as const;
  if (exactName.length > 1) return { error: "Multiple coupon groups have that name. Use the coupon group ID." } as const;
  const partial = coupons.filter((coupon) => String(coupon.couponName ?? "").toLowerCase().includes(normalized));
  if (partial.length === 1) return { coupon: partial[0] } as const;
  return { error: partial.length ? "Multiple coupon groups match. Use the coupon group ID." : "Coupon group not found." } as const;
}

export async function claimAdminCouponCode(groupQuery: string, note: string, actor: CouponActor) {
  const normalizedNote = note.trim().slice(0, 1000);
  if (!normalizedNote) return { ok: false, error: "A distribution note is required." };
  const snapshot = await getCoupons();
  if (snapshot.readError) return { ok: false, error: snapshot.readError };
  const resolved = resolveCouponGroup(snapshot.coupons, groupQuery);
  if ("error" in resolved) return { ok: false, error: resolved.error };
  const couponId = String(resolved.coupon.couponId ?? "");
  if (!validCouponId(couponId)) return { ok: false, error: "Coupon group has no valid provider ID." };
  try {
    const records = (await getCouponCodesWithMetadata(couponId)).filter((record) => couponCodeIsAvailable(record));
    for (const record of records.sort((a, b) => String(a.expireTime ?? "9999").localeCompare(String(b.expireTime ?? "9999")) || String(a.code).localeCompare(String(b.code)))) {
      if (!record.code) continue;
      const claimed = await updateCouponCodeMetadata(couponId, record.code, true, normalizedNote, record.metadataRevision, actor);
      if (claimed.ok) return { ok: true, couponId, couponName: resolved.coupon.couponName ?? null, code: record.code, expireTime: record.expireTime ?? null, note: normalizedNote, revision: claimed.revision };
      if (!claimed.error?.includes("changed elsewhere")) return claimed;
    }
    return { ok: false, error: "No unused, unexpired, undistributed coupon codes are available in this group." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function updateAdminCouponCode(couponId: string, code: string, distributed: boolean, extraInformation: string, expectedRevision: number | null, actor: CouponActor) {
  return updateCouponCodeMetadata(couponId, code, distributed, extraInformation, expectedRevision, actor);
}

export async function deleteAdminCoupon(couponId: string, actor: CouponActor): Promise<CouponResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, error: "Huaxin not configured." };
  if (!validCouponId(couponId)) return { ok: false, error: "Invalid coupon ID." };
  try {
    const result = await deleteCouponApi(cfg, couponId);
    await logCoupon("delete", { couponIds: couponId }, result, actor);
    const error = couponApiError(result);
    if (error) return { ok: false, error };
    const [warning, cleanupError] = await Promise.all([refreshCouponSnapshots(), deleteCouponCodeMetadata(couponId)]);
    return { ok: true, warning: [warning, cleanupError ? `Coupon was deleted, but local distribution information could not be removed: ${cleanupError}` : null].filter(Boolean).join(" ") || undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
