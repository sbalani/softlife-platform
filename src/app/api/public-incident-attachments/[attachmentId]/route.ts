import { getSessionProfile } from "@/lib/auth/session";
import { canAccessPublicIncident } from "@/lib/incident-workflow";
import { PUBLIC_REPORT_BUCKET } from "@/lib/public-reporting";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Not configured." }, { status: 503 });
  const actor = await getSessionProfile();
  if (!actor) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (!canAccessPublicIncident(actor.role)) return Response.json({ error: "Forbidden." }, { status: 403 });
  const s = await createServiceClient();
  const { data: attachment, error } = await s.from("public_incident_attachments")
    .select("storage_path,public_incident_submissions!inner(status)")
    .eq("id", (await params).attachmentId)
    .eq("public_incident_submissions.status", "submitted")
    .maybeSingle();
  if (error || !attachment) return Response.json({ error: "Not found." }, { status: 404 });
  const { data: signed, error: signedError } = await s.storage.from(PUBLIC_REPORT_BUCKET).createSignedUrl(attachment.storage_path as string, 60);
  if (signedError) return Response.json({ error: "Unable to open attachment." }, { status: 500 });
  return new Response(null, { status: 302, headers: { location: signed.signedUrl, "cache-control": "private, no-store" } });
}
