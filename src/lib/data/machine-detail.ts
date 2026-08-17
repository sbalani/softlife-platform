import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { menuFromSnapshot, type HuaxinStatusRow } from "@/lib/data/change-log";
import { storedOrderFromRow } from "@/lib/data/order-persistence";
import { ymd as localYmd } from "@/lib/dates";
import { translateLocation } from "@/lib/i18n/huaxin";
import type { ProductDiyItem } from "@/lib/huaxin/client";
import type { DetailMedia } from "@/lib/data/machine-media";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coversOrderRange } from "@/lib/data/order-sync-status";

export type DetailTemp = { time: string; value: number };
export type DetailOrder = {
  order_time: string;
  order_code: string;
  order_state: string;
  price: number;
  product_name: string;
  products: { goodsName: string; price?: number | string; position?: number }[];
  is_admin_override: boolean;
};
export type MachineDetail = {
  name: string;
  device_imei: string;
  device_id: string | null;
  location: string | null;
  online: boolean;
  machine_synced_at: string | null;
  temperatures: DetailTemp[];
  temperature_observed_at: string | null;
  orders: DetailOrder[];
  orders_synced_at: string | null;
  orders_fresh_from: string | null;
  orders_fresh_through: string | null;
  orders_sync_status: string | null;
  menu: { diy: ProductDiyItem[]; unify: ProductDiyItem[] };
  menu_synced_at: string | null;
  status: HuaxinStatusRow[];
  status_observed_at: string | null;
  media: DetailMedia[];
  media_synced_at: string | null;
};

function shiftDay(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function machineOrderRows(s: SupabaseClient, imei: string, from: string, to: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await s.from("v_orders").select("*").eq("device_imei", imei)
      .gte("order_time", `${shiftDay(from, -1)}T00:00:00Z`)
      .lte("order_time", `${shiftDay(to, 1)}T23:59:59Z`)
      .order("order_time", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 999);
    if (error) throw error;
    rows.push(...((data as Record<string, unknown>[]) ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

export async function getMachineDetail(
  imei: string,
  orderRange?: { from: string; to: string; timeZone: string },
): Promise<MachineDetail | null> {
  if (!isSupabaseConfigured()) return null;
  const s = await createServiceClient();
  const { data: machine, error: machineError } = await s
    .from("machines")
    .select("id,name,display_name,device_imei,device_id_huaxin,location,location_override,is_online,huaxin_last_sync")
    .eq("device_imei", imei)
    .maybeSingle();
  if (machineError) throw machineError;
  if (!machine) return null;

  const now = new Date();
  const range = orderRange ?? {
    from: localYmd(new Date(+now - 6 * 86_400_000), "UTC"),
    to: localYmd(now, "UTC"),
    timeZone: "UTC",
  };
  const [menuResult, statusResult, mediaResult, temperatureResult, orderResult, latestOrderSyncResult, orderCoverageResult] = await Promise.all([
    s.from("machine_menu_snapshots").select("snapshot,synced_at").eq("device_imei", imei).maybeSingle(),
    s.from("machine_status_snapshots").select("field,raw,observed_at").eq("machine_id", machine.id).order("observed_at", { ascending: false }),
    s.from("machine_media_snapshots").select("media,synced_at").eq("machine_id", machine.id).maybeSingle(),
    s.from("huaxin_temperatures").select("reading_time,series_name,value").eq("machine_id", machine.id).gte("reading_time", new Date(+now - 86_400_000).toISOString()).order("reading_time"),
    machineOrderRows(s, imei, range.from, range.to),
    s.from("order_sync_machine_results").select("status,finished_at").eq("device_imei", imei).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    s.from("order_sync_machine_results").select("fresh_through,order_sync_runs(requested_from)").eq("device_imei", imei).eq("status", "succeeded").gte("fresh_through", range.from).order("fresh_through").limit(1000),
  ]);
  for (const result of [menuResult, statusResult, mediaResult, temperatureResult, latestOrderSyncResult, orderCoverageResult]) {
    if (result.error) throw result.error;
  }

  const rawStatuses = ((statusResult.data as { field: string; raw: HuaxinStatusRow; observed_at: string }[]) ?? []);
  const fullStatuses = rawStatuses.filter((row) => row.field.startsWith("raw:"));
  const statusRows = fullStatuses.length ? fullStatuses : rawStatuses;
  const dedupedStatus = [...new Map(statusRows.map((row) => [row.raw.code ?? row.field, row.raw])).values()];
  const orderRows = orderResult.map(storedOrderFromRow).filter((order) => {
    const day = localYmd(new Date(order.order_time), range.timeZone);
    return day >= range.from && day <= range.to;
  });
  type CoverageRow = { fresh_through: string; order_sync_runs: { requested_from: string } | null };
  const coverageRows = (orderCoverageResult.data as unknown as CoverageRow[]) ?? [];
  const coverageIntervals = coverageRows.flatMap((row) => row.order_sync_runs ? [{ from: row.order_sync_runs.requested_from, through: row.fresh_through }] : []);
  const hasCoverage = coversOrderRange(coverageIntervals, range.from, range.to);
  const latestOrderSync = latestOrderSyncResult.data as { status: string; finished_at: string } | null;
  const allTemperatureRows = (temperatureResult.data as { reading_time: string; series_name: string; value: number }[]) ?? [];
  const cylinderSeries = allTemperatureRows.find((row) => row.series_name.toLowerCase().includes("cylinder"))?.series_name ?? allTemperatureRows[0]?.series_name;
  const temperatureRows = allTemperatureRows.filter((row) => row.series_name === cylinderSeries);
  const menuRow = menuResult.data as { snapshot: Record<string, Record<string, unknown>>; synced_at: string } | null;
  const mediaRow = mediaResult.data as { media: DetailMedia[]; synced_at: string } | null;

  return {
    name: machine.display_name || machine.name || imei,
    device_imei: imei,
    device_id: machine.device_id_huaxin ?? null,
    location: machine.location_override || translateLocation(machine.location) || null,
    online: Boolean(machine.is_online),
    machine_synced_at: machine.huaxin_last_sync ?? null,
    temperatures: temperatureRows.map((row) => ({ time: row.reading_time, value: Number(row.value) })),
    temperature_observed_at: temperatureRows.at(-1)?.reading_time ?? null,
    orders: orderRows.map((order) => ({
      order_time: order.order_time,
      order_code: order.order_code,
      order_state: order.order_state,
      price: order.price,
      product_name: order.product_name,
      products: order.products,
      is_admin_override: order.is_admin_override,
    })),
    orders_synced_at: latestOrderSync?.finished_at ?? null,
    orders_fresh_from: hasCoverage ? range.from : null,
    orders_fresh_through: hasCoverage ? range.to : null,
    orders_sync_status: latestOrderSync?.status ?? null,
    menu: menuRow ? menuFromSnapshot(menuRow.snapshot) : { diy: [], unify: [] },
    menu_synced_at: menuRow?.synced_at ?? null,
    status: dedupedStatus,
    status_observed_at: rawStatuses[0]?.observed_at ?? null,
    media: mediaRow?.media ?? [],
    media_synced_at: mediaRow?.synced_at ?? null,
  };
}
