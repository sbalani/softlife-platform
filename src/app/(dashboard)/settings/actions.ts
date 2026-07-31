"use server";

import {
  getConfigFromEnv,
  listAllOrders,
  listDevices,
  pullTemperatures,
} from "@/lib/huaxin/client";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geocode";
import { translateLocation } from "@/lib/i18n/huaxin";
import { normalizeHuaxinTimestamp } from "@/lib/data/temperatures";
import { orderRowFromHuaxin, tenantForOrder, type OrderAssignment } from "@/lib/data/order-persistence";
import { huaxinOrderTime } from "@/lib/huaxin/order-time";

export type SyncResult = { ok: boolean; summary: string };

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
/** Full Huaxin → Supabase ingestion: machines, temperatures (7d), orders (7d). */
export async function sync(_prev: SyncResult | null, _fd: FormData): Promise<SyncResult> {
  void _prev;
  void _fd;
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, summary: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, summary: "Supabase not configured." };

  try {
    const supabase = await createServiceClient();
    const devices = await listDevices(cfg, { force: true });
    const { data: assignmentRows } = await supabase.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date,end_date");
    const assignments = (assignmentRows as OrderAssignment[]) ?? [];
    const began = ymd(new Date(Date.now() - 90 * 86_400_000)) + " 00:00:00";
    const end = ymd(new Date()) + " 23:59:59";

    let machines = 0;
    let temps = 0;
    let orders = 0;

    for (const d of devices) {
      if (!d.deviceImei) continue;
      const { data: m } = await supabase
        .from("machines")
        .upsert(
          {
            device_imei: d.deviceImei,
            device_id_huaxin: d.deviceId ?? null,
            name: (d.deviceLabel as string) || d.deviceName || d.deviceImei,
            location: (d.deviceLocation as string) ?? null,
            state: "active",
            huaxin_last_sync: new Date().toISOString(),
          },
          { onConflict: "device_imei" },
        )
        .select("id,tenant_id")
        .single();
      machines++;
      const storedMachine = m as { id?: string; tenant_id?: string | null } | null;
      const machineId = storedMachine?.id ?? null;
      try {
        const t = await pullTemperatures(cfg, d.deviceImei, began, end);
        const category = t.category ?? [];
        const rows: {
          machine_id: string | null;
          reading_time: string;
          series_name: string;
          value: number;
        }[] = [];
        for (const series of t.dataset ?? []) {
          const sname = series.seriesname ?? "temperature";
          const sdata = series.data ?? [];
          for (let i = 0; i < sdata.length; i++) {
            rows.push({
              machine_id: machineId,
              reading_time: normalizeHuaxinTimestamp(category[i]?.label, ymd(new Date())),
              series_name: sname,
              value: Number(sdata[i]?.value ?? 0),
            });
          }
        }
        if (rows.length) {
          const { error } = await supabase.from("huaxin_temperatures").upsert(rows, {
            onConflict: "machine_id,reading_time,series_name",
            ignoreDuplicates: true,
          });
          if (!error) temps += rows.length;
        }
      } catch {
        /* per-device temperature errors are non-fatal */
      }

      try {
        const ords = (await listAllOrders(cfg, d.deviceImei, began, end)).filter((o) => o.orderCode);
        const rows = ords.map((order) => orderRowFromHuaxin(order, {
          id: machineId,
          tenantId: tenantForOrder(assignments, machineId, huaxinOrderTime(order)) ?? storedMachine?.tenant_id ?? null,
          imei: d.deviceImei!,
        }));
        if (rows.length) {
          const { error } = await supabase
            .from("huaxin_orders")
            .upsert(rows, { onConflict: "order_code" });
          if (!error) orders += rows.length;
        }
      } catch {
        /* per-device order errors are non-fatal */
      }
    }

    // Geocode machines whose effective address changed (or was never
    // geocoded) so the map views have coordinates. Nominatim allows 1 req/s.
    let geocoded = 0;
    try {
      const { data: rows } = await supabase
        .from("machines")
        .select("id,location,location_override,geocoded_from");
      for (const m of (rows as { id: string; location: string | null; location_override: string | null; geocoded_from: string | null }[]) ?? []) {
        const effective = m.location_override || translateLocation(m.location);
        if (!effective || effective === m.geocoded_from) continue;
        const hit = await geocodeAddress(effective);
        await new Promise((r) => setTimeout(r, 1100));
        if (!hit) continue;
        await supabase
          .from("machines")
          .update({ latitude: hit.lat, longitude: hit.lng, geocoded_from: effective })
          .eq("id", m.id);
        geocoded++;
      }
    } catch {
      /* geocoding is best-effort */
    }

    return {
      ok: true,
      summary: `Synced ${machines} machine(s), ${temps} temperature reading(s), ${orders} order(s) (90-day window), geocoded ${geocoded} location(s).`,
    };
  } catch (e) {
    return {
      ok: false,
      summary: `Sync failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
