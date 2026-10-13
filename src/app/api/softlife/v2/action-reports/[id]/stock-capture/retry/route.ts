import { after } from "next/server";
import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { runActionReportStockSnapshotJobs } from "@/lib/action-report-stock";
import { authorizedMobileActionReport } from "@/lib/data/mobile-action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.write")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const reportId = (await params).id;
  const s = await createServiceClient();
  const report = await authorizedMobileActionReport(s, session, reportId);
  if (!report || report.status !== "confirmed" || !(report.action_modes as string[]).includes("refill")) return Response.json({ error: { message: "Confirmed refill report not found" } }, { status: 404 });
  const { data, error } = await s.rpc("retry_service_action_stock_snapshot_job", { p_report_id: reportId, p_actor_id: session.id });
  if (error) return Response.json({ error: { message: error.message } }, { status: 409 });
  after(async () => { try { await runActionReportStockSnapshotJobs(1); } catch (workerError) { console.error("[mobile-action-report-stock-retry]", workerError); } });
  return Response.json({ stock_capture: data }, { status: 202 });
}
