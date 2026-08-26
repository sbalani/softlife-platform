import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { confirmManufacturingPeriod } from "@/lib/data/odoo-production";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  return handleOdooRequest(request, "odoo-manufacturing-period-confirm", async (client) => {
    const body = await request.json() as Record<string, unknown>;
    return confirmManufacturingPeriod(client, exportId, body);
  });
}
