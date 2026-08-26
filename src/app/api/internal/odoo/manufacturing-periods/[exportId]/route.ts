import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { getManufacturingPeriod } from "@/lib/data/odoo-production";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ exportId: string }> }) {
  const { exportId } = await params;
  return handleOdooRequest(request, "odoo-manufacturing-period", (client) => getManufacturingPeriod(client, exportId));
}
