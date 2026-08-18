import type { SupabaseClient } from "@supabase/supabase-js";
import type { MobileSession } from "@/lib/auth/mobile-authorization";
import { canAccessMobileMachine } from "@/lib/auth/mobile-authorization";

export async function authorizedMobileActionReport(s: SupabaseClient, session: MobileSession, reportId: string) {
  const { data, error } = await s.from("service_action_reports").select("id,machine_id,operator_id,occurred_at,status,tenant_id").eq("id", reportId).maybeSingle();
  if (error) throw error;
  if (!data || (session.role !== "admin" && data.operator_id !== session.id)) return null;
  if (!await canAccessMobileMachine(s, session, data.machine_id as string, data.occurred_at as string)) return null;
  if (!await canAccessMobileMachine(s, session, data.machine_id as string, new Date().toISOString())) return null;
  return data;
}
