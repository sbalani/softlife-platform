import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { Source } from "./machines";

export type OdooSku = {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  qty_available: number;
  uom: string | null;
  category: string | null;
};

export type OdooLotRow = {
  id: number;
  name: string;
  product_name: string | null;
  qty: number;
  expiration_date: string | null;
  warehouse_name: string | null;
  updated_at: string | null;
};

const SAMPLE_SKUS: OdooSku[] = [
  { id: 1, name: "Vanilla Soft-Serve Base 10L", sku: "BASE-VAN-10L", barcode: "8410000000012", qty_available: 42, uom: "Units", category: "Bases" },
  { id: 2, name: "Chocolate Sauce 5L", sku: "SAUCE-CHOC-5L", barcode: "8410000000029", qty_available: 18, uom: "Units", category: "Sauces" },
  { id: 3, name: "Oreo Crumble Topping 2kg", sku: "TOP-OREO-2KG", barcode: "8410000000036", qty_available: 7, uom: "Units", category: "Toppings" },
];

const SAMPLE_LOTS: OdooLotRow[] = [
  { id: 101, name: "LOT-2026-0611", product_name: "Vanilla Soft-Serve Base 10L", qty: 12, expiration_date: "2026-09-01", warehouse_name: "Madrid Central", updated_at: "2026-06-11T09:00:00Z" },
  { id: 102, name: "LOT-2026-0618", product_name: "Chocolate Sauce 5L", qty: 6, expiration_date: "2026-08-15", warehouse_name: "Costa Depot", updated_at: "2026-06-18T10:30:00Z" },
];

export async function getOdooSkus(): Promise<{ skus: OdooSku[]; source: Source }> {
  if (!isSupabaseConfigured()) return { skus: SAMPLE_SKUS, source: "sample" };
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("odoo_products")
      .select("odoo_id,name,sku,barcode,qty_available,uom,category")
      .order("name");
    const rows = (data as Record<string, unknown>[]) ?? [];
    if (!rows.length) return { skus: SAMPLE_SKUS, source: "sample" };
    return {
      skus: rows.map((r) => ({
        id: r.odoo_id as number,
        name: r.name as string,
        sku: (r.sku as string) ?? null,
        barcode: (r.barcode as string) ?? null,
        qty_available: Number(r.qty_available ?? 0),
        uom: (r.uom as string) ?? null,
        category: (r.category as string) ?? null,
      })),
      source: "supabase",
    };
  } catch (e) {
    console.error("[odoo] getOdooSkus failed:", e);
    return { skus: SAMPLE_SKUS, source: "sample" };
  }
}

export async function getOdooLots(): Promise<{ lots: OdooLotRow[]; source: Source }> {
  if (!isSupabaseConfigured()) return { lots: SAMPLE_LOTS, source: "sample" };
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("odoo_lots")
      .select("odoo_id,name,product_name,qty,expiration_date,warehouse_name,updated_at")
      .order("updated_at", { ascending: false });
    const rows = (data as Record<string, unknown>[]) ?? [];
    if (!rows.length) return { lots: SAMPLE_LOTS, source: "sample" };
    return {
      lots: rows.map((r) => ({
        id: r.odoo_id as number,
        name: r.name as string,
        product_name: (r.product_name as string) ?? null,
        qty: Number(r.qty ?? 0),
        expiration_date: (r.expiration_date as string) ?? null,
        warehouse_name: (r.warehouse_name as string) ?? null,
        updated_at: (r.updated_at as string) ?? null,
      })),
      source: "supabase",
    };
  } catch (e) {
    console.error("[odoo] getOdooLots failed:", e);
    return { lots: SAMPLE_LOTS, source: "sample" };
  }
}
