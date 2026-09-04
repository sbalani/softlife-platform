import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfigFromEnv, listDeviceProducts } from "@/lib/huaxin/client";
import { menuStockSnapshotItems } from "@/lib/action-report-stock-values";

const LANE_TO_POSITION: Record<string, string> = {
  "2": "solid_1", "3": "solid_2", "4": "solid_3",
  "5": "liquid_1", "6": "liquid_2", "7": "liquid_3",
};

type SnapshotResult = { id: string; status: "captured" | "needs_review"; duplicate: boolean };

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function captureActionReportStockSnapshot(s: SupabaseClient, reportId: string, actorId: string): Promise<SnapshotResult> {
  const { data: existing, error: existingError } = await s.from("service_action_stock_snapshots").select("id,status").eq("report_id", reportId).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { id: existing.id, status: existing.status as SnapshotResult["status"], duplicate: true };

  const { data: report, error: reportError } = await s.from("service_action_reports").select("id,machine_id,status,machines(device_imei,base_product_id)").eq("id", reportId).maybeSingle();
  if (reportError) throw reportError;
  if (!report || report.status !== "confirmed") throw new Error("Confirmed Action Report not found.");
  const machine = report.machines as unknown as { device_imei: string | null; base_product_id: string | null } | null;
  if (!machine?.device_imei) throw new Error("The machine has no Huaxin IMEI.");
  const cfg = getConfigFromEnv();
  if (!cfg) throw new Error("Huaxin is not configured.");

  const [{ data: ingredients, error: ingredientError }, observation] = await Promise.all([
    s.from("machine_ingredients").select("position,product_id").eq("machine_id", report.machine_id),
    listDeviceProducts(cfg, machine.device_imei).then((menu) => ({ menu, capturedAt: new Date().toISOString() })),
  ]);
  if (ingredientError) throw ingredientError;
  const { menu, capturedAt } = observation;
  const productByLane = new Map<string, string>();
  if (machine.base_product_id) productByLane.set("1", machine.base_product_id);
  const byPosition = new Map(((ingredients as { position: string; product_id: string | null }[]) ?? []).map((item) => [item.position, item.product_id]));
  for (const [lane, position] of Object.entries(LANE_TO_POSITION)) {
    const productId = byPosition.get(position);
    if (productId) productByLane.set(lane, productId);
  }

  const items = menuStockSnapshotItems(menu, productByLane);
  if (!items.length) throw new Error("Huaxin returned no menu items.");
  const rawPayload = { diy: menu.diy, unify: menu.unify };
  const canonical = JSON.stringify(rawPayload);
  const { data, error } = await s.rpc("record_service_action_stock_snapshot", {
    p_report_id: reportId,
    p_actor_id: actorId,
    p_device_imei: machine.device_imei,
    p_captured_at: capturedAt,
    p_raw_payload: rawPayload,
    p_response_sha256: await sha256(canonical),
    p_items: items,
  });
  if (error) throw error;
  return data as SnapshotResult;
}
