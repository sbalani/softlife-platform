import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { authorizedMobileActionReport } from "@/lib/data/mobile-action-report-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: { message: "Not configured" } }, { status: 503 });
  const session = await getApiSession(request);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "action_reports.attach")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const s = await createServiceClient();
  const attachmentId = (await params).attachmentId;
  const { data: attachment } = await s.from("service_action_attachments").select("id,report_id,storage_path").eq("id", attachmentId).maybeSingle();
  if (!attachment || !await authorizedMobileActionReport(s, session, attachment.report_id as string)) return Response.json({ error: { message: "Not found" } }, { status: 404 });
  const { error: auditError } = await s.from("service_action_attachment_access_log").insert({ attachment_id: attachment.id, actor_id: session.id, purpose: "mobile_download" });
  if (auditError) return Response.json({ error: { message: "Unable to audit access" } }, { status: 500 });
  const { data: signed, error } = await s.storage.from("service-action-evidence").createSignedUrl(attachment.storage_path as string, 60);
  if (error) return Response.json({ error: { message: error.message } }, { status: 500 });
  return Response.json({ signed_url: signed.signedUrl, expires_in: 60 }, { headers: { "cache-control": "no-store" } });
}
