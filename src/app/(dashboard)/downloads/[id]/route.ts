import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { MOBILE_APK_BUCKET } from "@/lib/mobile-builds";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionProfile();
  if (!session) redirect("/login?next=/downloads");
  const { id } = await params;
  const s = await createServiceClient();
  const { data: build, error } = await s.from("mobile_apk_builds").select("id,version,build_number,object_path").eq("id", id).maybeSingle();
  if (error || !build) return new Response("Build not found.", { status: 404 });
  const filenameParts = ["softlife", build.version, build.build_number].filter(Boolean);
  const filename = `${filenameParts.join("-") || "softlife-latest"}.apk`.replace(/[^A-Za-z0-9._-]/g, "-");
  const { data: signed, error: signedError } = await s.storage.from(MOBILE_APK_BUCKET).createSignedUrl(build.object_path, 60, { download: filename });
  if (signedError) return new Response("Could not prepare the APK download.", { status: 503 });
  const now = new Date().toISOString();
  const { error: stateError } = await s.from("mobile_apk_user_state").upsert({ user_id: session.id, build_id: build.id, downloaded_at: now, suppressed_at: null, updated_at: now }, { onConflict: "user_id,build_id" });
  if (stateError) return new Response("Could not record the APK download.", { status: 500 });
  return Response.redirect(signed.signedUrl, 307);
}
