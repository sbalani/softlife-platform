import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { getOdooCatalog } from "@/lib/data/odoo-production";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleOdooRequest(request, "odoo-catalog", (client) => getOdooCatalog(client, new URL(request.url)));
}
