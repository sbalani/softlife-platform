import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getTenants } from "./franchisees";

export type Transfer = {
  id: string;
  name: string;
  date: string;
  machine_name: string | null;
  from_tenant: string | null;
  to_tenant: string | null;
  note: string | null;
};

export async function getTransfers(): Promise<Transfer[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("machine_transfers")
      .select("id, name, date, machine_id, from_tenant_id, to_tenant_id, note")
      .order("date", { ascending: false });
    const tenants = await getTenants();
    const tbyId = new Map(tenants.map((t) => [t.id, t.name]));
    const { data: machinesData } = await s.from("machines").select("id, name");
    const mbyId = new Map(
      ((machinesData as { id: string; name: string }[]) ?? []).map((m) => [m.id, m.name]),
    );
    return ((data as Record<string, unknown>[]) ?? []).map((tr) => ({
      id: tr.id as string,
      name: (tr.name as string) ?? "—",
      date: tr.date as string,
      machine_name: tr.machine_id ? (mbyId.get(tr.machine_id as string) ?? null) : null,
      from_tenant: tr.from_tenant_id ? (tbyId.get(tr.from_tenant_id as string) ?? null) : null,
      to_tenant: tr.to_tenant_id ? (tbyId.get(tr.to_tenant_id as string) ?? null) : null,
      note: (tr.note as string) ?? null,
    }));
  } catch {
    return [];
  }
}
