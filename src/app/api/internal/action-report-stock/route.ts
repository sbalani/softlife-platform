import { timingSafeEqual } from "node:crypto";
import { captureActionReportStockSnapshot } from "@/lib/action-report-stock";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function authorized(request: Request) {
  const expected = process.env.ACTION_REPORT_STOCK_BRIDGE_TOKEN;
  const supplied = request.headers.get("x-action-report-stock-token");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  try {
    const body = await request.json() as { report_id?: unknown; actor_id?: unknown };
    if (typeof body.report_id !== "string" || !UUID.test(body.report_id) || typeof body.actor_id !== "string" || !UUID.test(body.actor_id)) {
      return Response.json({ error: "Invalid stock snapshot request" }, { status: 400 });
    }
    const s = await createServiceClient();
    const [{ data: report, error: reportError }, { data: actor, error: actorError }] = await Promise.all([
      s.from("service_action_reports").select("operator_id").eq("id", body.report_id).maybeSingle(),
      s.from("profiles").select("role").eq("id", body.actor_id).maybeSingle(),
    ]);
    if (reportError || actorError) throw reportError ?? actorError;
    if (!report || !actor || (actor.role !== "admin" && report.operator_id !== body.actor_id)) {
      return Response.json({ error: "Action Report not found" }, { status: 404 });
    }
    return Response.json(await captureActionReportStockSnapshot(s, body.report_id, body.actor_id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[action-report-stock-bridge] Request failed:", message);
    return Response.json({ error: message }, { status: 502 });
  }
}
