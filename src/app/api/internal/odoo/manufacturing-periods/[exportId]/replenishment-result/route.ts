import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { recordManufacturingReplenishmentResult } from "@/lib/data/odoo-production";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  return handleOdooRequest(request, "odoo-manufacturing-replenishment-result", async (client) => {
    const body = await request.json() as Record<string, unknown>;
    return recordManufacturingReplenishmentResult(client, exportId, body);
  });
}
