import { handleOdooRequest } from "@/lib/auth/odoo-route";
import { claimOdooSyncRequest } from "@/lib/data/odoo-sync-requests";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleOdooRequest(request, "odoo-sync-request-claim", claimOdooSyncRequest);
}
