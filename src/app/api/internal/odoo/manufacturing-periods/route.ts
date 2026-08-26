import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { listManufacturingPeriods, prepareManufacturingPeriod } from "@/lib/data/odoo-production";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleOdooRequest(request, "odoo-manufacturing-periods", (client) => listManufacturingPeriods(client, new URL(request.url)));
}

export async function POST(request: Request) {
  return handleOdooRequest(request, "odoo-manufacturing-period-prepare", async (client) => {
    const body = await request.json() as Record<string, unknown>;
    return prepareManufacturingPeriod(client, body);
  });
}
