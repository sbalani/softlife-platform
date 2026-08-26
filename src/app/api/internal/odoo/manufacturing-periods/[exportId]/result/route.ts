import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { recordManufacturingPeriodResult } from "@/lib/data/odoo-production";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  return handleOdooRequest(request, "odoo-manufacturing-period-result", async (client) => {
    const body = await request.json() as Record<string, unknown>;
    return recordManufacturingPeriodResult(client, exportId, body);
  });
}
