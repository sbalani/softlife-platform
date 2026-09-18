import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { completeOdooSyncRequest } from "@/lib/data/odoo-sync-requests";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return handleOdooRequest(request, "odoo-sync-request-result", async (client) => {
    const body = await request.json() as Record<string, unknown>;
    return completeOdooSyncRequest(client, requestId, body);
  });
}
