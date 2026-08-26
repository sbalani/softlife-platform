import type { SupabaseClient } from "@supabase/supabase-js";
import { OdooContractError } from "@/lib/data/odoo-production";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isOdooSyncAuthorized } from "./odoo-sync";

export async function handleOdooRequest(
  request: Request,
  label: string,
  operation: (client: SupabaseClient) => Promise<unknown>,
) {
  if (!isOdooSyncAuthorized(request)) return Response.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: "Not configured", code: "not_configured" }, { status: 503 });
  }
  try {
    const client = await createServiceClient();
    return Response.json(await operation(client));
  } catch (error) {
    if (error instanceof OdooContractError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "Invalid JSON body", code: "invalid_json" }, { status: 400 });
    }
    console.error(`[${label}]`, error);
    return Response.json({ error: "Internal sync error", code: "internal_error" }, { status: 500 });
  }
}
