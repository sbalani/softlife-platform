import { runActionReportStockSnapshotJobs } from "@/lib/action-report-stock";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Cron is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runActionReportStockSnapshotJobs(2));
  } catch (error) {
    console.error("[action-report-stock-cron]", error);
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
