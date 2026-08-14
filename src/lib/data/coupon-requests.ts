import type { SessionProfile } from "@/lib/auth/session";
import type { CreateCouponInput } from "@/lib/data/coupon-admin";
import { createAdminCoupon, getAdminCouponCodes, validateCouponInput } from "@/lib/data/coupon-admin";
import { createServiceClient } from "@/lib/supabase/server";
import { ymd } from "@/lib/dates";

export type CouponRequestStatus = "pending" | "granting" | "granted" | "rejected" | "failed";

export type CouponRequest = {
  id: string;
  tenantId: string;
  tenantName: string;
  requesterName: string;
  couponType: string;
  couponName: string;
  startDate: string;
  endDate: string;
  validDay: number;
  totalCount: number;
  usesPerCode: number;
  localName: string;
  money: number | null;
  amount: number | null;
  productPosition: string | null;
  productName: string | null;
  status: CouponRequestStatus;
  reviewNote: string | null;
  grantError: string | null;
  huaxinCouponId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  machines: { id: string; name: string }[];
};

type RequestRow = {
  id: string;
  tenant_id: string;
  requested_by: string;
  coupon_type: string;
  coupon_name: string;
  start_date: string;
  end_date: string;
  valid_day: number;
  total_count: number;
  uses_per_code: number;
  local_name: string;
  money: number | null;
  amount: number | null;
  product_position: string | null;
  product_name: string | null;
  status: CouponRequestStatus;
  review_note: string | null;
  grant_error: string | null;
  huaxin_coupon_id: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export async function getCouponRequests(session: SessionProfile): Promise<CouponRequest[]> {
  if (session.role === "operator" || (session.role === "franchisee" && !session.tenant_id)) return [];
  const s = await createServiceClient();
  let query = s.from("coupon_requests").select("*").order("created_at", { ascending: false });
  if (session.role === "franchisee") query = query.eq("tenant_id", session.tenant_id!);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data as RequestRow[]) ?? [];
  if (!rows.length) return [];
  const requestIds = rows.map((row) => row.id);
  const tenantIds = [...new Set(rows.map((row) => row.tenant_id))];
  const requesterIds = [...new Set(rows.map((row) => row.requested_by))];
  const [{ data: links, error: linkError }, { data: tenants, error: tenantError }, { data: profiles, error: profileError }] = await Promise.all([
    s.from("coupon_request_machines").select("request_id,machine_id,machines(id,name,display_name)").in("request_id", requestIds),
    s.from("tenants").select("id,name").in("id", tenantIds),
    s.from("profiles").select("id,full_name,email").in("id", requesterIds),
  ]);
  if (linkError) throw new Error(linkError.message);
  if (tenantError) throw new Error(tenantError.message);
  if (profileError) throw new Error(profileError.message);
  const tenantNames = new Map(((tenants as { id: string; name: string }[]) ?? []).map((row) => [row.id, row.name]));
  const requesterNames = new Map(((profiles as { id: string; full_name: string | null; email: string | null }[]) ?? []).map((row) => [row.id, row.full_name || row.email || "Franchisee"]));
  let accessibleIds: Set<string> | null = null;
  if (session.role === "franchisee") {
    const today = ymd(new Date(), "Europe/Madrid");
    const { data: assignments, error: assignmentError } = await s.from("machine_franchisee_assignments").select("machine_id")
      .eq("tenant_id", session.tenant_id!).lte("start_date", today).or(`end_date.is.null,end_date.gte.${today}`);
    if (assignmentError) throw new Error(assignmentError.message);
    accessibleIds = new Set(((assignments as { machine_id: string }[]) ?? []).map((row) => row.machine_id));
  }
  const machinesByRequest = new Map<string, CouponRequest["machines"]>();
  for (const link of (links as unknown as { request_id: string; machines: { id: string; name: string; display_name: string | null } | null }[]) ?? []) {
    if (!link.machines || (accessibleIds && !accessibleIds.has(link.machines.id))) continue;
    const machines = machinesByRequest.get(link.request_id) ?? [];
    machines.push({ id: link.machines.id, name: link.machines.display_name || link.machines.name });
    machinesByRequest.set(link.request_id, machines);
  }
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    tenantName: tenantNames.get(row.tenant_id) ?? "Franchisee",
    requesterName: requesterNames.get(row.requested_by) ?? "Franchisee",
    couponType: row.coupon_type,
    couponName: row.coupon_name,
    startDate: row.start_date,
    endDate: row.end_date,
    validDay: row.valid_day,
    totalCount: row.total_count,
    usesPerCode: row.uses_per_code,
    localName: row.local_name,
    money: row.money == null ? null : Number(row.money),
    amount: row.amount,
    productPosition: row.product_position,
    productName: row.product_name,
    status: row.status,
    reviewNote: row.review_note,
    grantError: row.grant_error,
    huaxinCouponId: row.huaxin_coupon_id,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    machines: machinesByRequest.get(row.id) ?? [],
  }));
}

export async function createCouponRequest(session: SessionProfile, input: CreateCouponInput) {
  if (session.role !== "franchisee" || !session.tenant_id) return { ok: false, error: "Franchisee access required." };
  const validationError = validateCouponInput(input);
  if (validationError) return { ok: false, error: validationError };
  const machineIds = [...new Set(input.machineIds)];
  const s = await createServiceClient();
  const { error } = await s.rpc("create_coupon_request", {
    p_tenant_id: session.tenant_id,
    p_requested_by: session.id,
    p_coupon_type: input.couponType,
    p_coupon_name: input.couponName.trim(),
    p_start_date: input.startTime,
    p_end_date: input.endTime,
    p_valid_day: input.validDay,
    p_total_count: input.totalCount,
    p_uses_per_code: input.secondary,
    p_local_name: input.localName.trim(),
    p_money: input.couponType === "0" ? input.money : null,
    p_amount: input.couponType === "1" ? input.amount : null,
    p_product_position: input.couponType === "1" ? input.productPosition?.trim() : null,
    p_product_name: input.couponType === "1" ? input.productName?.trim() : null,
    p_machine_ids: machineIds,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function requestForGrant(requestId: string) {
  const s = await createServiceClient();
  const [{ data: request, error }, { data: links, error: linkError }] = await Promise.all([
    s.from("coupon_requests").select("*").eq("id", requestId).maybeSingle(),
    s.from("coupon_request_machines").select("machine_id").eq("request_id", requestId),
  ]);
  if (error) throw new Error(error.message);
  if (linkError) throw new Error(linkError.message);
  return { s, request: request as RequestRow | null, machineIds: ((links as { machine_id: string }[]) ?? []).map((row) => row.machine_id) };
}

export async function grantCouponRequest(session: SessionProfile, requestId: string) {
  if (session.role !== "admin") return { ok: false, error: "Admin access required." };
  const { s, request, machineIds } = await requestForGrant(requestId);
  if (!request || request.status !== "pending") return { ok: false, error: "This request is no longer pending." };
  const today = ymd(new Date(), "Europe/Madrid");
  const { data: assignments, error: assignmentError } = await s.from("machine_franchisee_assignments").select("machine_id")
    .eq("tenant_id", request.tenant_id).in("machine_id", machineIds).lte("start_date", today).or(`end_date.is.null,end_date.gte.${today}`);
  if (assignmentError) return { ok: false, error: assignmentError.message };
  const assignedIds = new Set(((assignments as { machine_id: string }[]) ?? []).map((row) => row.machine_id));
  if (!machineIds.length || machineIds.some((id) => !assignedIds.has(id))) return { ok: false, error: "The franchisee's machine assignments changed. Reject this request and ask them to submit a new one." };
  const { data: claimed, error: claimError } = await s.from("coupon_requests").update({ status: "granting", updated_at: new Date().toISOString() })
    .eq("id", requestId).eq("status", "pending").select("id").maybeSingle();
  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed) return { ok: false, error: "Another administrator is already handling this request." };
  const result = await createAdminCoupon({
    couponType: request.coupon_type,
    couponName: request.coupon_name,
    startTime: request.start_date,
    endTime: request.end_date,
    validDay: request.valid_day,
    totalCount: request.total_count,
    secondary: request.uses_per_code,
    machineIds,
    localName: request.local_name,
    money: request.money == null ? undefined : Number(request.money),
    amount: request.amount ?? undefined,
    productPosition: request.product_position ?? undefined,
    productName: request.product_name ?? undefined,
  }, session);
  const reviewedAt = new Date().toISOString();
  if (!result.ok || !result.couponId) {
    const error = result.error ?? "Huaxin created the coupon without returning its ID. Verify it before retrying.";
    await s.from("coupon_requests").update({ status: "failed", reviewed_by: session.id, reviewed_at: reviewedAt, grant_error: error, updated_at: reviewedAt }).eq("id", requestId);
    return { ok: false, error };
  }
  const { error: updateError } = await s.from("coupon_requests").update({
    status: "granted",
    reviewed_by: session.id,
    reviewed_at: reviewedAt,
    huaxin_coupon_id: result.couponId,
    grant_error: null,
    updated_at: reviewedAt,
  }).eq("id", requestId).eq("status", "granting");
  if (updateError) return { ok: false, error: `Coupon ${result.couponId} was created, but the request could not be updated: ${updateError.message}` };
  return { ok: true, warning: result.warning };
}

export async function rejectCouponRequest(session: SessionProfile, requestId: string, note: string) {
  if (session.role !== "admin") return { ok: false, error: "Admin access required." };
  const s = await createServiceClient();
  const reviewedAt = new Date().toISOString();
  const { data, error } = await s.from("coupon_requests").update({ status: "rejected", reviewed_by: session.id, reviewed_at: reviewedAt, review_note: note.trim() || null, updated_at: reviewedAt })
    .eq("id", requestId).eq("status", "pending").select("id").maybeSingle();
  if (error) return { ok: false, error: error.message };
  return data ? { ok: true } : { ok: false, error: "This request is no longer pending." };
}

export async function getGrantedCouponRecords(session: SessionProfile, requestId: string) {
  if (session.role !== "franchisee" || !session.tenant_id) return { records: [], error: "Franchisee access required." };
  const s = await createServiceClient();
  const [{ data, error }, { data: links, error: linkError }] = await Promise.all([
    s.from("coupon_requests").select("huaxin_coupon_id").eq("id", requestId).eq("tenant_id", session.tenant_id).eq("status", "granted").maybeSingle(),
    s.from("coupon_request_machines").select("machine_id").eq("request_id", requestId),
  ]);
  if (error) return { records: [], error: error.message };
  if (linkError) return { records: [], error: linkError.message };
  if (!data?.huaxin_coupon_id) return { records: [], error: "Granted coupon not found." };
  const machineIds = ((links as { machine_id: string }[]) ?? []).map((row) => row.machine_id);
  const today = ymd(new Date(), "Europe/Madrid");
  const { data: assignments, error: assignmentError } = await s.from("machine_franchisee_assignments").select("machine_id")
    .eq("tenant_id", session.tenant_id).in("machine_id", machineIds).lte("start_date", today).or(`end_date.is.null,end_date.gte.${today}`);
  if (assignmentError) return { records: [], error: assignmentError.message };
  const assignedIds = new Set(((assignments as { machine_id: string }[]) ?? []).map((row) => row.machine_id));
  if (!machineIds.length || machineIds.some((id) => !assignedIds.has(id))) return { records: [], error: "This coupon is no longer available because its machine assignment changed." };
  try {
    return { records: await getAdminCouponCodes(String(data.huaxin_coupon_id)) };
  } catch (error) {
    return { records: [], error: error instanceof Error ? error.message : String(error) };
  }
}
