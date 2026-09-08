import type { SessionProfile } from "@/lib/auth/session";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type SalesContextNote = {
  id: string;
  salesDate: string;
  category: "event" | "promotion" | "operations" | "competition" | "other";
  body: string;
  sourceUrl: string | null;
  machineId: string | null;
  machineName: string | null;
  authorName: string;
  canDelete: boolean;
  revision: number;
  createdAt: string;
};

export async function getSalesContextNotes(session: SessionProfile | null, from: string, to: string, machineId?: string): Promise<SalesContextNote[]> {
  if (!session || !isSupabaseConfigured() || !["admin", "franchisee"].includes(session.role)) return [];
  const { data, error } = await (await createServiceClient()).rpc("read_sales_context_notes", {
    p_actor_id: session.id, p_from: from, p_to: to, p_machine_id: machineId ?? null,
  });
  if (error) throw new Error(error.message);
  return ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    id: String(row.id), salesDate: String(row.sales_date), category: row.category as SalesContextNote["category"],
    body: String(row.body), sourceUrl: row.source_url ? String(row.source_url) : null,
    machineId: row.machine_id ? String(row.machine_id) : null, machineName: row.machine_name ? String(row.machine_name) : null,
    authorName: String(row.author_name), canDelete: row.can_delete === true, revision: Number(row.revision), createdAt: String(row.created_at),
  }));
}
