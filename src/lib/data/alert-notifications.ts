import type { SupabaseClient } from "@supabase/supabase-js";
import { MOBILE_CAPABILITIES, canReceiveMobileAlert, mobileMachineIds, normalizeMobileRole } from "@/lib/auth/mobile-authorization";

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

export type AlertNotificationResult = {
  sent: number;
  tokens: number;
  claimed: number;
  eligible: number;
  failed: number;
  status: "sent" | "partial_failure" | "no_tokens" | "no_alerts" | "no_eligible_recipients" | "delivery_failed" | "error";
};

async function updateAlert(s: SupabaseClient, alertId: string, values: Record<string, string | null>) {
  const { error } = await s.from("alerts").update(values).eq("id", alertId);
  if (error) throw error;
}

export async function sendPendingAlertNotifications(s: SupabaseClient): Promise<AlertNotificationResult> {
  const { data: tokens, error: tokenError } = await s.from("mobile_push_tokens").select("id,user_id,expo_push_token");
  if (tokenError) throw tokenError;
  const pushTokens = (tokens as PushToken[]) ?? [];
  if (!pushTokens.length) return { sent: 0, tokens: 0, claimed: 0, eligible: 0, failed: 0, status: "no_tokens" };
  const { data: alerts, error: alertError } = await s.rpc("claim_pending_alert_pushes", { p_limit: 50 });
  if (alertError) throw alertError;
  if (!alerts?.length) return { sent: 0, tokens: pushTokens.length, claimed: 0, eligible: 0, failed: 0, status: "no_alerts" };

  const userIds = [...new Set(pushTokens.map((token) => token.user_id))];
  const { data: profiles, error: profileError } = await s.from("profiles").select("id,role,tenant_id,employer_kind").in("id", userIds);
  if (profileError) throw profileError;
  const profileById = new Map(((profiles as Profile[]) ?? []).map((profile) => [profile.id, profile]));
  const machineIdsByUser = new Map<string, string[] | null>();
  for (const profile of profileById.values()) {
    const role = normalizeMobileRole(profile.role);
    machineIdsByUser.set(profile.id, await mobileMachineIds(s, {
      id: profile.id,
      email: null,
      role,
      tenantId: profile.tenant_id,
      employerKind: ["softlife", "franchisee", "contractor"].includes(profile.employer_kind) ? profile.employer_kind as "softlife" | "franchisee" | "contractor" : "softlife",
      scopeVersion: 1,
      capabilities: MOBILE_CAPABILITIES[role],
    }));
  }
  let sent = 0;
  let eligibleRecipients = 0;
  let failed = 0;

  for (const alert of alerts as unknown as AlertRow[]) {
    const eligible: PushToken[] = [];
    for (const token of pushTokens) {
      const profile = profileById.get(token.user_id);
      if (!profile) continue;
      const role = normalizeMobileRole(profile.role);
      if (canReceiveMobileAlert(role, machineIdsByUser.get(profile.id), alert.machine_id)) eligible.push(token);
    }
    if (!eligible.length) {
      await updateAlert(s, alert.id, { push_claimed_at: null });
      continue;
    }
    eligibleRecipients += eligible.length;
    const machine = alert.machine_name || "Machine alert";
    let accepted = 0;
    try {
      for (let offset = 0; offset < eligible.length; offset += 100) {
        const chunk = eligible.slice(offset, offset + 100);
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
          },
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
        let rejected = false;
        for (let index = 0; index < chunk.length; index++) {
          const ticket = tickets[index];
          if (ticket?.status === "ok") { accepted++; continue; }
          if (ticket?.details?.error === "DeviceNotRegistered") await s.from("mobile_push_tokens").delete().eq("id", chunk[index].id);
          else { rejected = true; console.error(`[alert-push] Expo rejected ${alert.id}:`, ticket?.message ?? "Unknown ticket error"); }
        }
        if (rejected) throw new Error("Expo rejected one or more alert notifications");
      }
      if (!accepted) throw new Error("No active device accepted the alert notification");
    } catch (error) {
      failed++;
      await updateAlert(s, alert.id, { push_claimed_at: null });
      console.error(`[alert-push] Delivery failed for ${alert.id}:`, error);
      continue;
    }
    await updateAlert(s, alert.id, { push_notified_at: new Date().toISOString(), push_claimed_at: null });
    sent += accepted;
  }
  const status = sent > 0 ? failed > 0 ? "partial_failure" : "sent" : failed > 0 ? "delivery_failed" : "no_eligible_recipients";
  return { sent, tokens: pushTokens.length, claimed: alerts.length, eligible: eligibleRecipients, failed, status };
}
