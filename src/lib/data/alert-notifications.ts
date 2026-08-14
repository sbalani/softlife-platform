import type { SupabaseClient } from "@supabase/supabase-js";
import { MOBILE_CAPABILITIES, mobileMachineIds, normalizeMobileRole } from "@/lib/auth/mobile-authorization";

type PushToken = { id: string; user_id: string; expo_push_token: string };
type Profile = { id: string; role: string; tenant_id: string | null; employer_kind: string };
type AlertRow = {
  id: string;
  severity: string;
  machine_id: string | null;
  title: string;
  message: string;
  created_at: string;
  machine_name: string | null;
};

export async function sendPendingAlertNotifications(s: SupabaseClient): Promise<number> {
  const { data: tokens, error: tokenError } = await s.from("mobile_push_tokens").select("id,user_id,expo_push_token");
  if (tokenError) throw tokenError;
  const pushTokens = (tokens as PushToken[]) ?? [];
  if (!pushTokens.length) return 0;
  const { data: alerts, error: alertError } = await s.rpc("claim_pending_alert_pushes", { p_limit: 50 });
  if (alertError) throw alertError;
  if (!alerts?.length) return 0;

  const userIds = [...new Set(pushTokens.map((token) => token.user_id))];
  const { data: profiles, error: profileError } = await s.from("profiles").select("id,role,tenant_id,employer_kind").in("id", userIds);
  if (profileError) throw profileError;
  const profileById = new Map(((profiles as Profile[]) ?? []).map((profile) => [profile.id, profile]));
  let sent = 0;

  for (const alert of alerts as unknown as AlertRow[]) {
    const eligible: PushToken[] = [];
    for (const token of pushTokens) {
      const profile = profileById.get(token.user_id);
      if (!profile) continue;
      const role = normalizeMobileRole(profile.role);
      const machineIds = await mobileMachineIds(s, {
        id: profile.id,
        email: null,
        role,
        tenantId: profile.tenant_id,
        employerKind: ["softlife", "franchisee", "contractor"].includes(profile.employer_kind) ? profile.employer_kind as "softlife" | "franchisee" | "contractor" : "softlife",
        scopeVersion: 1,
        capabilities: MOBILE_CAPABILITIES[role],
      });
      if (alert.machine_id ? machineIds === null || machineIds.includes(alert.machine_id) : role === "admin") eligible.push(token);
    }
    if (!eligible.length) {
      continue;
    }
    const machine = alert.machine_name || "Machine alert";
    try {
      for (let offset = 0; offset < eligible.length; offset += 100) {
        const chunk = eligible.slice(offset, offset + 100);
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(chunk.map((token) => ({
            to: token.expo_push_token,
            sound: "default",
            title: `${alert.title} · ${machine}`,
            body: alert.message,
            data: { machineId: alert.machine_id, alertId: alert.id },
            channelId: "machine-alerts",
          }))),
        });
        if (!response.ok) throw new Error(`Expo push failed: ${response.status} ${await response.text()}`);
        const tickets = (await response.json() as { data?: { status?: string; message?: string; details?: { error?: string } }[] }).data ?? [];
        for (let index = 0; index < chunk.length; index++) {
          const ticket = tickets[index];
          if (ticket?.status === "ok") continue;
          if (ticket?.details?.error === "DeviceNotRegistered") await s.from("mobile_push_tokens").delete().eq("id", chunk[index].id);
          else console.error(`[alert-push] Expo rejected ${alert.id}:`, ticket?.message ?? "Unknown ticket error");
        }
      }
    } catch (error) {
      await s.from("alerts").update({ push_notified_at: null }).eq("id", alert.id);
      console.error(`[alert-push] Delivery failed for ${alert.id}:`, error);
      continue;
    }
    sent += eligible.length;
  }
  return sent;
}
