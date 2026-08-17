import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const { id } = await params;
  const s = await createServiceClient();
  const { data: build, error: buildError } = await s.from("mobile_apk_builds").select("id").eq("id", id).maybeSingle();
  if (buildError) return Response.json({ error: { message: buildError.message } }, { status: 500 });
  if (!build) return Response.json({ error: { message: "Build not found." } }, { status: 404 });
  const now = new Date().toISOString();
  const { error } = await s.from("mobile_apk_user_state").upsert({ user_id: session.id, build_id: id, suppressed_at: now, updated_at: now }, { onConflict: "user_id,build_id" });
  if (error) return Response.json({ error: { message: error.message } }, { status: 500 });
  return Response.json({ ok: true });
}
