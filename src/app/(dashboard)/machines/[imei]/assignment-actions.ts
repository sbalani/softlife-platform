"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type AssignmentResult = { ok: boolean; error?: string };

async function requireAdmin() {
  const session = await getSessionProfile();
  return session?.role === "admin";
}

async function refreshCurrentCustomer(machineId: string) {
  const service = await createServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await service
    .from("machine_franchisee_assignments")
    .select("tenant_id,start_date")
    .eq("machine_id", machineId)
    .lte("start_date", today)
    .or(`end_date.is.null,end_date.gte.${today}`)
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  await service.from("machines").update({ customer_id: data?.tenant_id ?? null }).eq("id", machineId);
}

export async function addFranchiseeAssignment(_previous: AssignmentResult | null, formData: FormData): Promise<AssignmentResult> {
  if (!await requireAdmin()) return { ok: false, error: "Admin access required." };
  const machineId = String(formData.get("machine_id") ?? "");
  const imei = String(formData.get("imei") ?? "");
  const tenantId = String(formData.get("tenant_id") ?? "");
  const startDate = String(formData.get("start_date") ?? "");
  const endDate = String(formData.get("end_date") ?? "") || null;
  const serviceModel = String(formData.get("service_model") ?? "customer_service");
  const defaults: Record<string, number> = { customer_service: 26, softlife_service: 18 };
  const sharePercent = serviceModel === "custom" ? Number(formData.get("custom_percent")) : defaults[serviceModel];

  if (!machineId || !tenantId || !startDate) return { ok: false, error: "Machine, franchisee, and start date are required." };
  if (endDate && endDate < startDate) return { ok: false, error: "End date cannot be before start date." };
  if (!Number.isFinite(sharePercent) || sharePercent < 0 || sharePercent > 100) return { ok: false, error: "Share must be between 0 and 100%." };

  const service = await createServiceClient();
  const { data: existing } = await service
    .from("machine_franchisee_assignments")
    .select("start_date,end_date")
    .eq("machine_id", machineId);
  const overlaps = ((existing as { start_date: string; end_date: string | null }[]) ?? []).some((row) =>
    row.start_date <= (endDate ?? "9999-12-31") && (row.end_date ?? "9999-12-31") >= startDate,
  );
  if (overlaps) return { ok: false, error: "This date range overlaps an existing franchisee assignment." };

  const { error } = await service.from("machine_franchisee_assignments").insert({
    machine_id: machineId,
    tenant_id: tenantId,
    start_date: startDate,
    end_date: endDate,
    service_model: serviceModel,
    share_percent: sharePercent,
  });
  if (error) return { ok: false, error: error.message };
  await refreshCurrentCustomer(machineId);
  revalidatePath(`/machines/${imei}`);
  revalidatePath("/analytics");
  return { ok: true };
}

export async function removeFranchiseeAssignment(id: string, machineId: string, imei: string): Promise<AssignmentResult> {
  if (!await requireAdmin()) return { ok: false, error: "Admin access required." };
  const service = await createServiceClient();
  const { error } = await service.from("machine_franchisee_assignments").delete().eq("id", id).eq("machine_id", machineId);
  if (error) return { ok: false, error: error.message };
  await refreshCurrentCustomer(machineId);
  revalidatePath(`/machines/${imei}`);
  revalidatePath("/analytics");
  return { ok: true };
}
