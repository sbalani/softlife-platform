import { getApiSession } from "@/lib/auth/api-session";
import { runHuaxinFleetSync } from "@/lib/data/huaxin-fleet-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (session.role !== "admin") return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  try {
    return Response.json(await runHuaxinFleetSync("settings"));
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}
