import "server-only";

import type { SessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type CashboxMachineSummary = {
  machineId: string;
  trackingEnabled: boolean;
  expectedCents: number | null;
  anchorAt: string | null;
  lastCollectionAt: string | null;
};

export type CashboxAlert = {
  id: string;
  machineId: string;
  machineName: string;
  deviceImei: string | null;
  severity: "warning" | "critical";
  title: string;
  message: string;
  createdAt: string;
};

export async function getCashboxMachineSummaries(session: SessionProfile, machineIds: string[]): Promise<Map<string, CashboxMachineSummary>> {
  const summaries = new Map<string, CashboxMachineSummary>();
  if (!session.cash_access || machineIds.length === 0) return summaries;
  const s = await createServiceClient();
  const { data: machines, error: machineError } = await s.from("machines")
    .select("id,cash_tracking_enabled").in("id", machineIds);
  if (machineError) throw machineError;
  const enabledIds = ((machines as { id: string; cash_tracking_enabled: boolean }[]) ?? [])
    .filter((machine) => machine.cash_tracking_enabled).map((machine) => machine.id);
  if (!enabledIds.length) return summaries;
  const { data: accounts, error: accountError } = await s.from("machine_cash_accounts")
    .select("machine_id,anchor_at,last_collection_at,disabled_at").in("machine_id", enabledIds).is("disabled_at", null);
  if (accountError) throw accountError;
  for (const account of (accounts as { machine_id: string; anchor_at: string; last_collection_at: string | null }[]) ?? []) {
    const { data: allowed, error: accessError } = await s.rpc("cash_actor_can_access_machine", {
      p_actor_id: session.id, p_machine_id: account.machine_id, p_at: new Date().toISOString(),
    });
    if (accessError) throw accessError;
    if (!allowed) continue;
    const { data: expected, error: expectedError } = await s.rpc("machine_cash_expected_cents", { p_machine_id: account.machine_id, p_at: new Date().toISOString() });
    if (expectedError) throw expectedError;
    summaries.set(account.machine_id, {
      machineId: account.machine_id,
      trackingEnabled: true,
      expectedCents: expected == null ? null : Number(expected),
      anchorAt: account.anchor_at,
      lastCollectionAt: account.last_collection_at,
    });
  }
  return summaries;
}

export async function getActiveCashboxAlerts(session: SessionProfile): Promise<CashboxAlert[]> {
  if (session.role !== "admin") return [];
  const s = await createServiceClient();
  const { data, error } = await s.from("machine_cash_alerts")
    .select("id,machine_id,severity,title,message,created_at,machines(name,display_name,device_imei)")
    .is("resolved_at", null).order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as Record<string, unknown>[]) ?? []).map((row) => {
    const machine = row.machines as { name: string; display_name: string | null; device_imei: string | null } | null;
    return {
      id: String(row.id), machineId: String(row.machine_id), machineName: machine?.display_name || machine?.name || "Unknown machine",
      deviceImei: machine?.device_imei ?? null, severity: row.severity as CashboxAlert["severity"], title: String(row.title),
      message: String(row.message), createdAt: String(row.created_at),
    };
  });
}
