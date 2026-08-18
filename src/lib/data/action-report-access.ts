import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionProfile } from "@/lib/auth/session";
import { canAccessMachine } from "@/lib/data/service-access";

export async function authorizedActionReport(s: SupabaseClient, actor: SessionProfile, reportId: string, requireDraft = false) {
  const { data, error } = await s.from("service_action_reports")
    .select("id,client_uuid,machine_id,operator_id,occurred_at,status,tenant_id,action_kind,notes,cleaning_material_used,water_bucket_count,assigned_warehouse_id,source")
    .eq("id", reportId).maybeSingle();
  if (error) throw error;
  if (!data || (requireDraft && data.status !== "draft")) return null;
  if (actor.role !== "admin" && data.operator_id !== actor.id) return null;
  if (!await canAccessMachine(s, actor, data.machine_id as string, data.occurred_at as string)) return null;
  return data;
}
