import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getConfigFromEnv, listCoupons, type HuaxinConfig, type HuaxinCoupon } from "@/lib/huaxin/client";
import { fleetFreshness } from "@/lib/data/fleet-freshness";
import { aggregateCouponSnapshots } from "@/lib/data/coupon-snapshot-aggregation";

export type Coupon = HuaxinCoupon;
type CouponSnapshot = { device_imei: string; coupons: Coupon[]; synced_at: string };

export async function syncCouponSnapshots(s: SupabaseClient, cfg: HuaxinConfig, imeis: string[]) {
  if (!imeis.length) return { synced: 0, failed: [] as string[] };
  const { data: machines, error: machineError } = await s.from("machines").select("id,device_imei").in("device_imei", imeis);
  if (machineError) throw machineError;
  const machineByImei = new Map(((machines as { id: string; device_imei: string }[]) ?? []).map((machine) => [machine.device_imei, machine.id]));
  let synced = 0;
  const failed: string[] = [];
  for (const imei of imeis) {
    const machineId = machineByImei.get(imei);
    if (!machineId) { failed.push(`${imei}: machine is not stored`); continue; }
    try {
      const coupons = await listCoupons(cfg, imei);
      const { error } = await s.from("machine_coupon_snapshots").upsert({ machine_id: machineId, device_imei: imei, coupons, synced_at: new Date().toISOString() });
      if (error) throw error;
      synced++;
    } catch (error) {
      failed.push(`${imei}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { synced, failed };
}

export async function syncAllCouponSnapshots(s: SupabaseClient, cfg: HuaxinConfig) {
  const { data, error } = await s.from("machines").select("device_imei").not("device_imei", "is", null);
  if (error) throw error;
  return syncCouponSnapshots(s, cfg, ((data as { device_imei: string }[]) ?? []).map((row) => row.device_imei));
}

export async function getCoupons(): Promise<{ coupons: Coupon[]; latestSyncedAt: string | null; staleMachines: number; readError?: string }> {
  if (!isSupabaseConfigured()) return { coupons: [], latestSyncedAt: null, staleMachines: 0, readError: "Supabase is not configured." };
  try {
    const s = await createServiceClient();
    const [{ data: snapshots, error: snapshotError }, { data: machines, error: machineError }] = await Promise.all([
      s.from("machine_coupon_snapshots").select("device_imei,coupons,synced_at"),
      s.from("machines").select("device_imei").not("device_imei", "is", null),
    ]);
    if (snapshotError) throw snapshotError;
    if (machineError) throw machineError;
    const expectedImeis = ((machines as { device_imei: string }[]) ?? []).map((row) => row.device_imei);
    const expected = new Set(expectedImeis);
    const rows = ((snapshots as CouponSnapshot[]) ?? []).filter((row) => expected.has(row.device_imei));
    const byImei = new Map(rows.map((row) => [row.device_imei, row.synced_at]));
    const freshness = fleetFreshness(expectedImeis.map((imei) => byImei.get(imei) ?? null));
    return { coupons: aggregateCouponSnapshots(rows), latestSyncedAt: freshness.latest, staleMachines: freshness.stale };
  } catch (error) {
    console.error("[coupons] Supabase read failed:", error);
    return { coupons: [], latestSyncedAt: null, staleMachines: 0, readError: error instanceof Error ? error.message : String(error) };
  }
}

export async function refreshCouponSnapshots() {
  const cfg = getConfigFromEnv();
  if (!cfg || !isSupabaseConfigured()) return "Coupon changed in Huaxin, but Supabase coupon sync is not configured.";
  try {
    const result = await syncAllCouponSnapshots(await createServiceClient(), cfg);
    return result.failed.length ? `Coupon changed in Huaxin, but ${result.failed.length} machine snapshot(s) failed to refresh.` : undefined;
  } catch (error) {
    return `Coupon changed in Huaxin, but the Supabase snapshot refresh failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
