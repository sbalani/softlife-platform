import { getApiSession } from "@/lib/auth/api-session";
import { canAccessMobileMachine, hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { menuFromSnapshot } from "@/lib/data/change-log";
import { presentMachineMenu } from "@/lib/data/mobile-machine-menu";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INGREDIENT_LANES: Record<string, string> = {
  solid_1: "2",
  solid_2: "3",
  solid_3: "4",
  liquid_1: "5",
  liquid_2: "6",
  liquid_3: "7",
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "machines.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const id = (await params).id.toLowerCase();
  if (!UUID_RE.test(id)) return Response.json({ error: { message: "Invalid machine ID" } }, { status: 400 });

  try {
    const service = await createServiceClient();
    const notFound = () => Response.json({ error: { message: "Machine not found or not assigned to you" } }, { status: 404 });
    if (!await canAccessMobileMachine(service, session, id, new Date().toISOString())) return notFound();

    const { data: machine, error: machineError } = await service.from("machines")
      .select("id,device_imei,base_product_id").eq("id", id).maybeSingle();
    if (machineError) throw machineError;
    if (!machine) return notFound();

    const [snapshotResult, ingredientsResult] = await Promise.all([
      machine.device_imei
        ? service.from("machine_menu_snapshots").select("snapshot,synced_at").eq("device_imei", machine.device_imei).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      service.from("machine_ingredients").select("position,product_id").eq("machine_id", id),
    ]);
    if (snapshotResult.error) throw snapshotResult.error;
    if (ingredientsResult.error) throw ingredientsResult.error;

    const productIds: Record<string, string | null> = { "1": machine.base_product_id as string | null };
    for (const row of (ingredientsResult.data as { position: string; product_id: string | null }[]) ?? []) {
      const lane = INGREDIENT_LANES[row.position];
      if (lane) productIds[lane] = row.product_id;
    }
    const snapshot = snapshotResult.data as { snapshot: Record<string, unknown>; synced_at: string } | null;
    return Response.json({
      machine_id: id,
      ...presentMachineMenu(snapshot ? menuFromSnapshot(snapshot.snapshot as Record<string, Record<string, unknown>>) : null, snapshot?.synced_at ?? null, productIds),
    });
  } catch (error) {
    console.error("[mobile-menu] Request failed:", error);
    return Response.json({ error: { message: "Could not load machine menu" } }, { status: 500 });
  }
}
