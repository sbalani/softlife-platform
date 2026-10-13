import { getSessionProfile } from "@/lib/auth/session";
import { after } from "next/server";
import { runActionReportStockSnapshotJobs } from "@/lib/action-report-stock";
import { authorizedActionReport } from "@/lib/data/action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const reportId = (await params).id;
    const s = await createServiceClient();
    const report = await authorizedActionReport(s, actor, reportId);
    if (!report || report.status !== "confirmed" || !(report.action_modes as string[]).includes("refill")) return Response.json({ error: "Confirmed refill report not found" }, { status: 404 });
    const { data, error } = await s.rpc("retry_service_action_stock_snapshot_job", { p_report_id: reportId, p_actor_id: actor.id });
    if (error) throw error;
    after(async () => { try { await runActionReportStockSnapshotJobs(1); } catch (workerError) { console.error("[action-report-stock-after]", workerError); } });
    return Response.json(data, { status: 202 });
  } catch (error) {
    console.error("[action-report-stock-snapshot]", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to capture menu stock" }, { status: 500 });
  }
}
