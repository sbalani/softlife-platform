import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function authorized(s: SupabaseClient, token: string | null) {
  if (!token) return false;
  const { data, error } = await s.rpc("verify_public_incident_cleanup_token", { p_token: token });
  if (error) throw error;
  return data === true;
}

export async function cleanupAbandonedPublicIncidentDrafts(s: SupabaseClient) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  let deleted = 0;
  while (true) {
    const { data: submissions, error: submissionError } = await s.from("public_incident_submissions")
      .select("id").eq("status", "draft").lt("token_expires_at", cutoff).order("token_expires_at").limit(100);
    if (submissionError) throw submissionError;
    const ids = (submissions ?? []).map((row) => String(row.id));
    if (!ids.length) break;

    const { data: attachments, error: attachmentError } = await s.from("public_incident_attachments")
      .select("storage_path").in("submission_id", ids);
    if (attachmentError) throw attachmentError;
    const paths = (attachments ?? []).map((row) => String(row.storage_path));
    if (paths.length) {
      const { error: storageError } = await s.storage.from("public-incident-evidence").remove(paths);
      if (storageError) throw storageError;
    }
    const { error: deleteAttachmentError } = await s.from("public_incident_attachments").delete().in("submission_id", ids);
    if (deleteAttachmentError) throw deleteAttachmentError;
    const { error: deleteSubmissionError, count } = await s.from("public_incident_submissions")
      .delete({ count: "exact" }).in("id", ids).eq("status", "draft").lt("token_expires_at", cutoff);
    if (deleteSubmissionError) throw deleteSubmissionError;
    deleted += count ?? 0;
    if (ids.length < 100) break;
  }
  return deleted;
}

if (import.meta.main) {
  Deno.serve(async (request) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const s = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if (!await authorized(s, request.headers.get("x-cron-token"))) return Response.json({ error: "Unauthorized" }, { status: 401 });
      EdgeRuntime.waitUntil(cleanupAbandonedPublicIncidentDrafts(s).then((deleted) => console.log("Expired public incident drafts removed", { deleted })));
      return Response.json({ accepted: true }, { status: 202 });
    } catch (error) {
      console.error("Public incident cleanup request failed", error);
      return Response.json({ error: "Cleanup unavailable" }, { status: 500 });
    }
  });
}
