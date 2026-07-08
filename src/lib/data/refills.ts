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
  operator_id: string | null;
  device_event_time: string;
  status: string;
  lines: RefillLine[];
};

type PayloadLine = {
  lot_name?: string;
  quantity_used?: number;
  photo_url?: string | null;
  batch_photo?: string | null; // mobile app submits base64 under this key
};

export async function getRefillHistory(): Promise<Refill[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("reposiciones")
      .select("id, operator_id, device_event_time, status, payload_json, machines(name)")
      .order("device_event_time", { ascending: false })
      .limit(100);
    return ((data as Record<string, unknown>[]) ?? []).map((r) => {
      const payload = (r.payload_json as { lines?: PayloadLine[] }) ?? {};
      const machine = r.machines as { name?: string } | null;
      return {
        id: r.id as string,
        machine_name: machine?.name ?? null,
        operator_id: (r.operator_id as string) ?? null,
        device_event_time: r.device_event_time as string,
        status: (r.status as string) ?? "pending",
        lines: (payload.lines ?? []).map((l) => ({
          lot_name: l.lot_name ?? "—",
          quantity_used: Number(l.quantity_used ?? 0),
          has_photo: !!(l.photo_url || l.batch_photo),
          photo_url: l.photo_url ?? null,
        })),
      };
    });
  } catch {
    return [];
  }
}
