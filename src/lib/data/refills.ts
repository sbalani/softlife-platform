import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type RefillLine = {
  lot_name: string;
  quantity_used: number;
  has_photo: boolean;
  photo_url: string | null;
};

export type Refill = {
  id: string;
  machine_name: string | null;
  operator_name: string | null;
  device_event_time: string;
  status: string;
  odoo_sync_status: string;
  lines: RefillLine[];
};

type PayloadLine = {
  odoo_lot_id?: number;
  lot_name?: string;
  quantity_used?: number;
  photo_url?: string | null;
  batch_photo?: string | null; // mobile app submits base64 under this key
};

export async function getRefillHistory(machineIds?: string[]): Promise<Refill[]> {
  if (!isSupabaseConfigured()) return [];
  if (machineIds && !machineIds.length) return [];
  const s = await createServiceClient();
  let query = s
    .from("reposiciones")
    .select("id, device_event_time, status, odoo_sync_status, payload_json, machines(name), profiles(full_name,email)")
    .order("device_event_time", { ascending: false })
    .limit(100);
  if (machineIds) query = query.in("machine_id", machineIds);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data as Record<string, unknown>[]) ?? [];
  const odooLotIds = [...new Set(rows.flatMap((row) => {
    const payload = (row.payload_json as { lines?: PayloadLine[] }) ?? {};
    return (payload.lines ?? []).flatMap((line) => line.odoo_lot_id ? [line.odoo_lot_id] : []);
  }))];
  const odooLotNames = new Map<number, string>();
  if (odooLotIds.length) {
    const { data: odooLots, error: lotError } = await s.from("odoo_lots").select("odoo_id,name").in("odoo_id", odooLotIds);
    if (lotError) throw lotError;
    for (const lot of (odooLots as { odoo_id: number; name: string }[]) ?? []) odooLotNames.set(lot.odoo_id, lot.name);
  }
  return rows.map((r) => {
      const payload = (r.payload_json as { lines?: PayloadLine[] }) ?? {};
      const machine = r.machines as { name?: string } | null;
      const operator = r.profiles as { full_name?: string; email?: string } | null;
      return {
        id: r.id as string,
        machine_name: machine?.name ?? null,
        operator_name: operator?.full_name ?? operator?.email ?? null,
        device_event_time: r.device_event_time as string,
        status: (r.status as string) ?? "pending",
        odoo_sync_status: (r.odoo_sync_status as string) ?? "pending",
        lines: (payload.lines ?? []).map((l) => ({
          lot_name: l.lot_name ?? (l.odoo_lot_id ? odooLotNames.get(l.odoo_lot_id) : null) ?? "—",
          quantity_used: Number(l.quantity_used ?? 0),
          has_photo: !!(l.photo_url || l.batch_photo),
          photo_url: l.photo_url ?? null,
        })),
      };
  });
}
