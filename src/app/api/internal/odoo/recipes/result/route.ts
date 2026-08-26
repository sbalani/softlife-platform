import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { recordOdooRecipeResult } from "@/lib/data/odoo-production";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleOdooRequest(request, "odoo-recipe-result", async (client) => {
    const body = await request.json() as Record<string, unknown>;
    return recordOdooRecipeResult(client, body);
  });
}
