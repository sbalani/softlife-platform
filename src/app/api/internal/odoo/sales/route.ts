import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { getOdooSales } from "@/lib/data/odoo-production";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleOdooRequest(request, "odoo-sales", (client) => getOdooSales(client, new URL(request.url)));
}
