import type { SupabaseClient } from "@supabase/supabase-js";
import type { MobileSession } from "../auth/mobile-authorization.ts";
import { getDeviceStatus, listDeviceProducts, type HuaxinConfig } from "../huaxin/client.ts";
import { recordMachineStatuses, recordMachineSync } from "./change-log.ts";

const STATUS_STALE_MS = 2 * 60 * 60 * 1000;
const MENU_STALE_MS = 26 * 60 * 60 * 1000;

export type RefreshFreshness = {
  statusObservedAt: string | null;
  menuSyncedAt: string | null;
};

export type RefreshComponent = {
  outcome: "succeeded" | "failed" | "skipped";
  freshness: "fresh" | "stale" | "missing";
  age_seconds: number | null;
  observed_at?: string | null;
  synced_at?: string | null;
  error?: { code: "refresh_failed"; message: string };
};

export type MachineRefreshResult = {
  ok: boolean;
  partial: boolean;
  refresh: {
    started_at: string;
    finished_at: string;
    status: RefreshComponent;
    menu: RefreshComponent;
  };
};

function freshness(timestamp: string | null, staleAfterMs: number, now: number) {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(parsed)) return { freshness: "missing" as const, age_seconds: null };
  const ageSeconds = Math.max(0, Math.floor((now - parsed) / 1000));
  return { freshness: now - parsed > staleAfterMs ? "stale" as const : "fresh" as const, age_seconds: ageSeconds };
}

export function presentRefreshComponents(
  outcomes: { status: "succeeded" | "failed" | "skipped"; menu: "succeeded" | "failed" | "skipped" },
  current: RefreshFreshness,
  now = Date.now(),
) {
  const status: RefreshComponent = { outcome: outcomes.status, observed_at: current.statusObservedAt, ...freshness(current.statusObservedAt, STATUS_STALE_MS, now) };
  const menu: RefreshComponent = { outcome: outcomes.menu, synced_at: current.menuSyncedAt, ...freshness(current.menuSyncedAt, MENU_STALE_MS, now) };
  if (outcomes.status === "failed") status.error = { code: "refresh_failed", message: "Status refresh failed" };
  if (outcomes.menu === "failed") menu.error = { code: "refresh_failed", message: "Menu refresh failed" };
  return { status, menu };
}

export async function runRefreshComponents(input: {
  refreshStatus: () => Promise<void>;
  refreshMenu: () => Promise<void>;
  readFreshness: () => Promise<RefreshFreshness>;
  now?: () => Date;
}): Promise<MachineRefreshResult> {
  const startedAt = (input.now?.() ?? new Date()).toISOString();
  const [statusResult, menuResult] = await Promise.allSettled([input.refreshStatus(), input.refreshMenu()]);
  const finished = input.now?.() ?? new Date();
  const current = await input.readFreshness().catch(() => ({ statusObservedAt: null, menuSyncedAt: null }));
  const components = presentRefreshComponents({
    status: statusResult.status === "fulfilled" ? "succeeded" : "failed",
    menu: menuResult.status === "fulfilled" ? "succeeded" : "failed",
  }, current, finished.getTime());
  const succeeded = Number(statusResult.status === "fulfilled") + Number(menuResult.status === "fulfilled");
  return {
    ok: succeeded > 0,
    partial: succeeded === 1,
    refresh: { started_at: startedAt, finished_at: finished.toISOString(), ...components },
  };
}

export async function readMachineRefreshFreshness(s: SupabaseClient, machineId: string, imei: string): Promise<RefreshFreshness> {
  const [statusResult, menuResult] = await Promise.all([
    s.from("machine_status_snapshots").select("observed_at").eq("machine_id", machineId).like("field", "raw:%").order("observed_at", { ascending: false }).limit(1).maybeSingle(),
    s.from("machine_menu_snapshots").select("synced_at").eq("device_imei", imei).maybeSingle(),
  ]);
  if (statusResult.error) throw statusResult.error;
  if (menuResult.error) throw menuResult.error;
  return { statusObservedAt: statusResult.data?.observed_at ?? null, menuSyncedAt: menuResult.data?.synced_at ?? null };
}

export async function refreshHuaxinMachine(
  s: SupabaseClient,
  cfg: HuaxinConfig,
  machine: { id: string; device_imei: string; name: string | null },
  actor: Pick<MobileSession, "id" | "email">,
  owner: string,
) {
  async function renewLease() {
    const { data, error } = await s.rpc("renew_huaxin_machine_refresh", { p_machine_id: machine.id, p_owner: owner });
    if (error) throw error;
    if (!data) throw new Error("Machine refresh lease expired");
  }
  return runRefreshComponents({
    refreshStatus: async () => {
      const statuses = await getDeviceStatus(cfg, machine.device_imei);
      await renewLease();
      await recordMachineStatuses(s, machine, statuses);
    },
    refreshMenu: async () => {
      const menu = await listDeviceProducts(cfg, machine.device_imei);
      await renewLease();
      await recordMachineSync(s, machine, menu, actor);
    },
    readFreshness: () => readMachineRefreshFreshness(s, machine.id, machine.device_imei),
  });
}

export type MachineRefreshClaim = { claimed: boolean; reason: "claimed" | "in_progress" | "cooldown" | "fleet_sync"; retry_after_seconds: number };

export function parseMachineRefreshClaim(data: unknown): MachineRefreshClaim {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("Invalid machine refresh claim response");
  const value = row as Record<string, unknown>;
  const reason = String(value.reason) as MachineRefreshClaim["reason"];
  if (!["claimed", "in_progress", "cooldown", "fleet_sync"].includes(reason)) throw new Error("Invalid machine refresh claim reason");
  return { claimed: value.claimed === true, reason, retry_after_seconds: Math.max(1, Number(value.retry_after_seconds) || 1) };
}
