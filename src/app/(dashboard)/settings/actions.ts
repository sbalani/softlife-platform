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

export type SyncResult = { ok: boolean; summary: string };

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function toIso(s?: string): string | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

/** Full Huaxin → Supabase ingestion: machines, temperatures (7d), orders (7d). */
export async function sync(_prev: SyncResult | null, _fd: FormData): Promise<SyncResult> {
  const cfg = getConfigFromEnv();
  if (!cfg) return { ok: false, summary: "Huaxin not configured." };
  if (!isSupabaseConfigured()) return { ok: false, summary: "Supabase not configured." };

  try {
    const supabase = await createServiceClient();
    const devices = await listDevices(cfg, { force: true });
    const began = ymd(new Date(Date.now() - 7 * 86_400_000)) + " 00:00:00";
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
        .select("id")
        .single();
      machines++;
      const machineId = (m as { id?: string } | null)?.id ?? null;
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
              reading_time: category[i]?.label ? `${ymd(new Date())} ${category[i].label}` : new Date().toISOString(),
              series_name: sname,
              value: Number(sdata[i]?.value ?? 0),
            });
          }
        }
        if (rows.length) {
          const { error } = await supabase.from("huaxin_temperatures").insert(rows);
          if (!error) temps += rows.length;
        }
      } catch {
        /* per-device temperature errors are non-fatal */
      }

      try {
        const ords = (await listAllOrders(cfg, d.deviceImei, began, end)).filter((o) => o.orderCode);
        const rows = ords.map((o) => ({
          machine_id: machineId,
          device_imei: d.deviceImei,
          order_code: o.orderCode!,
          out_trade_no: o.outTradeNo ?? null,
          order_state: String(o.status ?? ""),
          order_time: toIso(o.createTime),
          price: Number(o.price ?? 0),
          amount: Number(o.amount ?? 0),
          product_name: o.products?.[0]?.goodsName ?? o.goodsName ?? null,
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
      summary: `Synced ${machines} machine(s), ${temps} temperature reading(s), ${orders} order(s), geocoded ${geocoded} location(s).`,
    };
  } catch (e) {
    return {
      ok: false,
      summary: `Sync failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
