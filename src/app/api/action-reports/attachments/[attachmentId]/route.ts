import { getSessionProfile } from "@/lib/auth/session";
import { authorizedActionReport } from "@/lib/data/action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured" }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const s = await createServiceClient();
  const attachmentId = (await params).attachmentId;
  const { data: attachment, error } = await s.from("service_action_attachments").select("id,report_id,storage_path").eq("id", attachmentId).maybeSingle();
  if (error || !attachment || !await authorizedActionReport(s, actor, attachment.report_id as string)) return Response.json({ error: "Not found" }, { status: 404 });
  const { error: auditError } = await s.from("service_action_attachment_access_log").insert({ attachment_id: attachment.id, actor_id: actor.id, purpose: "playback" });
  if (auditError) return Response.json({ error: "Unable to audit attachment access" }, { status: 500 });
  const { data: signed, error: signedError } = await s.storage.from("service-action-evidence").createSignedUrl(attachment.storage_path as string, 60);
  if (signedError) return Response.json({ error: "Unable to sign attachment" }, { status: 500 });
  return new Response(null, { status: 302, headers: { location: signed.signedUrl, "cache-control": "no-store" } });
}
