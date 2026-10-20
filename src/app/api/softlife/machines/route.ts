import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability, mobileMachineIds } from "@/lib/auth/mobile-authorization";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "machines.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  try {
    const s = await createServiceClient();
    const allowedIds = await mobileMachineIds(s, session);
    if (allowedIds?.length === 0) return Response.json([]);
    let query = s.from("machines")
      .select("id,name,display_name,last_full_clean_date,odoo_warehouse_id,cash_tracking_enabled,odoo_warehouses(name)").order("name");
    if (allowedIds) query = query.in("id", allowedIds);
    const { data, error } = await query;
    if (error) throw error;
    const canUseCashbox = hasMobileCapability(session, "cashbox.write");
    const presented = [];
    for (const machine of (data ?? []) as Record<string, unknown>[]) {
      let cashExpectedCents: number | null = null;
      if (canUseCashbox && machine.cash_tracking_enabled === true) {
        const { data: expected, error: expectedError } = await s.rpc("machine_cash_expected_cents", { p_machine_id: machine.id, p_at: new Date().toISOString() });
        if (expectedError) throw expectedError;
        cashExpectedCents = expected == null ? null : Number(expected);
      }
      presented.push({
      id: machine.id,
      name: machine.display_name || machine.name,
      partner_id: 0,
      partner_name: null,
      location_id: 0,
      warehouse_id: machine.odoo_warehouse_id ?? null,
      warehouse_name: (machine.odoo_warehouses as { name?: string } | null)?.name ?? null,
      last_full_clean_date: machine.last_full_clean_date ?? null,
      cash_tracking_enabled: canUseCashbox && machine.cash_tracking_enabled === true,
      cash_expected_cents: cashExpectedCents,
      });
    }
    return Response.json(presented);
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
