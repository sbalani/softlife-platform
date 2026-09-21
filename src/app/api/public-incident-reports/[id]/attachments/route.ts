import { PUBLIC_REPORT_BUCKET, isSameOrigin, publicReportFile } from "@/lib/public-reporting";
import { authorizedPublicDraft } from "@/lib/public-reporting-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Reporting is temporarily unavailable." }, { status: 503 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request." }, { status: 403 });
  let uploadedPath = "";
  let attachmentId = "";
  try {
    const submissionId = (await params).id;
    const draft = await authorizedPublicDraft(request, submissionId);
    if (!draft) return Response.json({ error: "Draft not found or expired." }, { status: 404 });
    const body = await request.json() as Record<string, unknown>;
    attachmentId = typeof body.attachment_id === "string" ? body.attachment_id : "";
    uploadedPath = typeof body.path === "string" ? body.path : "";
    if (!uploadedPath.startsWith(`${submissionId}/`) || !attachmentId) return Response.json({ error: "Invalid attachment reservation." }, { status: 400 });
    const { data: info, error: infoError } = await draft.client.storage.from(PUBLIC_REPORT_BUCKET).info(uploadedPath);
    if (infoError) throw infoError;
    const storedMime = String(info.contentType ?? info.metadata?.mimetype ?? "").split(";")[0];
    const file = publicReportFile(storedMime, body.filename, Number(info.size));
    if ("error" in file || body.mime_type !== file.mimeType || body.kind !== file.kind) {
      await draft.client.storage.from(PUBLIC_REPORT_BUCKET).remove([uploadedPath]);
      await draft.client.from("public_incident_attachments").delete().eq("id", attachmentId).eq("submission_id", submissionId).is("completed_at", null);
      return Response.json({ error: "The uploaded attachment is invalid." }, { status: 400 });
    }
    const { error } = await draft.client.rpc("complete_public_incident_attachment", {
      p_submission_id: submissionId,
      p_token_hash: draft.tokenHash,
      p_attachment_id: attachmentId,
      p_storage_path: uploadedPath,
      p_mime_type: file.mimeType,
      p_size_bytes: file.sizeBytes,
    });
    if (error) {
      await draft.client.storage.from(PUBLIC_REPORT_BUCKET).remove([uploadedPath]);
      await draft.client.from("public_incident_attachments").delete().eq("id", attachmentId).eq("submission_id", submissionId).is("completed_at", null);
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ attachment_id: attachmentId }, { status: 201 });
  } catch (error) {
    if (uploadedPath) {
      try {
        const submissionId = (await params).id;
        const draft = await authorizedPublicDraft(request, submissionId);
        if (draft) {
          await draft.client.storage.from(PUBLIC_REPORT_BUCKET).remove([uploadedPath]);
          if (attachmentId) await draft.client.from("public_incident_attachments").delete().eq("id", attachmentId).eq("submission_id", submissionId).is("completed_at", null);
        }
      } catch { /* Keep the original upload error response. */ }
    }
    console.error("[public-incident-attachment]", error);
    return Response.json({ error: "Unable to confirm the attachment." }, { status: 500 });
  }
}
