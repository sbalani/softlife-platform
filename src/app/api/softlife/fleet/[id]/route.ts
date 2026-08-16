import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { mobileMachineAnalytics } from "@/lib/data/mobile-analytics";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "analytics.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const id = (await params).id.toLowerCase();
  if (!UUID_RE.test(id)) return Response.json({ error: { message: "Invalid machine ID" } }, { status: 400 });
  try {
    const service = await createServiceClient();
    if (!await canAccessMobileMachine(service, session, id, new Date().toISOString())) {
      return Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 });
    }
    const result = await mobileMachineAnalytics(id, service);
    return result ? Response.json(result) : Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
