import { PUBLIC_REPORT_BUCKET, isSameOrigin, publicReportFile } from "@/lib/public-reporting";
import { authorizedPublicDraft } from "@/lib/public-reporting-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Reporting is temporarily unavailable." }, { status: 503 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request." }, { status: 403 });
  try {
    const submissionId = (await params).id;
    const draft = await authorizedPublicDraft(request, submissionId);
    if (!draft) return Response.json({ error: "Draft not found or expired." }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    const file = publicReportFile(body.mime_type, body.filename, body.size_bytes);
    if ("error" in file) return Response.json({ error: file.error }, { status: 400 });
    const path = `${submissionId}/${crypto.randomUUID()}.${file.extension}`;
    const originalName = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
    if (!originalName) return Response.json({ error: "Attachment name is required." }, { status: 400 });
    const { data: attachmentId, error: reservationError } = await draft.client.rpc("reserve_public_incident_attachment", {
      p_submission_id: submissionId, p_token_hash: draft.tokenHash, p_kind: file.kind, p_storage_path: path,
      p_mime_type: file.mimeType, p_size_bytes: file.sizeBytes, p_original_name: originalName,
    });
    if (reservationError) return Response.json({ error: reservationError.message }, { status: 400 });
    const { data, error } = await draft.client.storage.from(PUBLIC_REPORT_BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (error) {
      await draft.client.from("public_incident_attachments").delete().eq("id", attachmentId).is("completed_at", null);
      throw error;
    }
    return Response.json({ attachment_id: attachmentId, path: data.path, token: data.token, mime_type: file.mimeType, kind: file.kind });
  } catch (error) {
    console.error("[public-incident-upload]", error);
    return Response.json({ error: "Unable to prepare the attachment." }, { status: 500 });
  }
}
