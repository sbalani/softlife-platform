import { createHash } from "node:crypto";
import type { SessionProfile } from "@/lib/auth/session";
import { ONE_CUP_COMPATIBILITY } from "@/lib/coupon-content";
import { couponDaysBetween } from "@/lib/coupon-dates";
import { couponCodeIsAvailable } from "@/lib/coupon-groups";
import { claimAdminCouponCode, createAdminCoupon, getAdminCouponCodes, getAdminCouponGroups, resolveCouponGroup, updateAdminCouponCode, type CreateCouponInput } from "@/lib/data/coupon-admin";
import { getCoupons } from "@/lib/data/coupons";
import { createServiceClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Actor = Pick<SessionProfile, "id" | "email">;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, stable(nested)]));
}

async function idempotent<T>(clientUuid: string, actor: Actor, operation: "create_group" | "distribute_code", request: unknown, run: () => Promise<T>): Promise<T & { duplicate?: boolean }> {
  if (!UUID.test(clientUuid)) throw new Error("A valid UUID idempotency key is required.");
  const s = await createServiceClient();
  const requestHash = createHash("sha256").update(JSON.stringify(stable(request))).digest("hex");
  const read = async () => s.from("mcp_coupon_operations").select("actor_id,operation,request_hash,status,result,error").eq("client_uuid", clientUuid).maybeSingle();
  let { data: existing, error: readError } = await read();
  if (readError) throw readError;
  if (!existing) {
    const { error } = await s.from("mcp_coupon_operations").insert({ client_uuid: clientUuid, actor_id: actor.id, operation, request_hash: requestHash });
    if (error?.code === "23505") ({ data: existing, error: readError } = await read());
    else if (error) throw error;
    if (readError) throw readError;
  }
  if (existing) {
    if (existing.actor_id !== actor.id || existing.operation !== operation || existing.request_hash !== requestHash) throw new Error("Idempotency key conflicts with another coupon operation.");
    if (existing.status === "completed") return { ...(existing.result as T), duplicate: true };
    if (existing.status === "failed") throw new Error(String(existing.error ?? "Coupon operation previously failed."));
    throw new Error("Coupon operation is already processing. Do not retry with a new idempotency key.");
  }
  try {
    const result = await run();
    const { error } = await s.from("mcp_coupon_operations").update({ status: "completed", result, updated_at: new Date().toISOString() }).eq("client_uuid", clientUuid).eq("status", "processing");
    if (error) throw error;
    return result as T & { duplicate?: boolean };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await s.from("mcp_coupon_operations").update({ status: "failed", error: message.slice(0, 5000), updated_at: new Date().toISOString() }).eq("client_uuid", clientUuid).eq("status", "processing");
    throw error;
  }
}

export async function createCouponGroupFromMcp(clientUuid: string, input: CreateCouponInput, actor: Actor) {
  return idempotent(clientUuid, actor, "create_group", input, async () => {
    const result = await createAdminCoupon(input, actor);
    if (!result.ok) throw new Error(result.error ?? "Coupon group could not be created.");
    return { coupon_id: result.couponId ?? null, status: "created", warning: result.warning ?? null };
  });
}

export async function distributeCouponFromMcp(clientUuid: string, groupQuery: string, code: string | null, note: string, actor: Actor) {
  return idempotent(clientUuid, actor, "distribute_code", { groupQuery, code, note }, async () => {
    if (!code) {
      const result = await claimAdminCouponCode(groupQuery, note, actor);
      if (!result.ok) throw new Error(result.error ?? "Coupon code could not be distributed.");
      const claimed = result as { couponId: string; couponName: string | null; code: string; expireTime: string | null; note: string; revision?: number };
      return { coupon_id: claimed.couponId, coupon_name: claimed.couponName, code: claimed.code, expires_at: claimed.expireTime, note: claimed.note, revision: claimed.revision, distributed: true };
    }
    const snapshot = await getCoupons();
    if (snapshot.readError) throw new Error(snapshot.readError);
    const resolved = resolveCouponGroup(snapshot.coupons, groupQuery);
    if ("error" in resolved) throw new Error(resolved.error);
    const couponId = String(resolved.coupon.couponId ?? "");
    const record = (await getAdminCouponCodes(couponId)).find((candidate) => candidate.code === code);
    if (!record) throw new Error("Coupon code was not found in this group.");
    if (!couponCodeIsAvailable(record)) throw new Error("Coupon code is used, expired, or already distributed.");
    const updated = await updateAdminCouponCode(couponId, code, true, note, record.metadataRevision, actor);
    if (!updated.ok) throw new Error(updated.error ?? "Coupon code could not be distributed.");
    return { coupon_id: couponId, coupon_name: resolved.coupon.couponName ?? null, code, expires_at: record.expireTime ?? null, note: note.trim(), revision: updated.revision, distributed: true };
  });
}

export async function couponMcpRead(groupQuery?: string) {
  if (!groupQuery) return getAdminCouponGroups();
  const snapshot = await getCoupons();
  if (snapshot.readError) throw new Error(snapshot.readError);
  const resolved = resolveCouponGroup(snapshot.coupons, groupQuery);
  if ("error" in resolved) throw new Error(resolved.error);
  const couponId = String(resolved.coupon.couponId ?? "");
  return { group: resolved.coupon, codes: await getAdminCouponCodes(couponId) };
}

export function mcpCreateCouponInput(body: Record<string, unknown>): CreateCouponInput {
  const couponType = body.coupon_type === "one_cup" ? "1" : "0";
  const startTime = String(body.start_date ?? "");
  const endTime = String(body.end_date ?? "");
  return {
    couponType,
    couponName: String(body.name ?? ""),
    startTime,
    endTime,
    validDay: couponDaysBetween(startTime, endTime),
    totalCount: Number(body.code_count),
    secondary: Number(body.uses_per_code),
    machineIds: Array.isArray(body.machine_ids) ? body.machine_ids.map(String) : [],
    localName: String(body.location_label ?? ""),
    money: couponType === "0" ? Number(body.discount_amount) : undefined,
    amount: couponType === "1" ? ONE_CUP_COMPATIBILITY.amount : undefined,
    productPosition: couponType === "1" ? ONE_CUP_COMPATIBILITY.productPosition : undefined,
    productName: couponType === "1" ? ONE_CUP_COMPATIBILITY.productName : undefined,
  };
}
