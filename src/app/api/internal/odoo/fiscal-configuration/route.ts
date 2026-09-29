import { getFiscalConfigurationRequest, recordFiscalConfiguration } from "@/lib/data/odoo-fiscal";
import { handleOdooRequest } from "@/lib/auth/odoo-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleOdooRequest(request, "odoo-fiscal-configuration-get", getFiscalConfigurationRequest);
}

export async function POST(request: Request) {
  return handleOdooRequest(request, "odoo-fiscal-configuration-post", async (client) => {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new SyntaxError("Invalid JSON body");
    return recordFiscalConfiguration(client, body as Record<string, unknown>);
  });
}
