import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { createPayoutPdf, type PayoutRow } from "@/lib/payout-report";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Snapshot = { tenantName: string; from: string; to: string; rows: PayoutRow[] };

function validSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<Snapshot>;
  return typeof snapshot.tenantName === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.from ?? "")
    && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.to ?? "")
    && Array.isArray(snapshot.rows);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSessionProfile(), params]);
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.role === "operator") return new Response("Forbidden", { status: 403 });
  if (!UUID.test(id)) return new Response("Invalid payout", { status: 400 });

  let query = (await createServiceClient())
    .from("franchisee_payout_settlements")
    .select("id,tenant_id,period_month,status,source_snapshot")
    .eq("id", id)
    .eq("status", "paid");
  if (session.role === "franchisee") {
    if (!session.tenant_id) return new Response("Forbidden", { status: 403 });
    query = query.eq("tenant_id", session.tenant_id);
  }
  const { data, error } = await query.maybeSingle();
  if (error) return new Response("Could not load payout", { status: 500 });
  if (!data) return new Response("Payout not found", { status: 404 });
  if (!validSnapshot(data.source_snapshot)) return new Response("Payout snapshot is invalid", { status: 500 });

  const pdf = await createPayoutPdf({
    franchiseeName: data.source_snapshot.tenantName,
    from: data.source_snapshot.from,
    to: data.source_snapshot.to,
    rows: data.source_snapshot.rows,
  });
  const filename = `payout-${String(data.period_month).slice(0, 7)}.pdf`;
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
