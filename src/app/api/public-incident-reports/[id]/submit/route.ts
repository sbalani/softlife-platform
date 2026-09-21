import { isSameOrigin } from "@/lib/public-reporting";
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
    const { data, error } = await draft.client.rpc("submit_public_incident", { p_submission_id: submissionId, p_token_hash: draft.tokenHash });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ incident_id: data }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[public-incident-submit]", error);
    return Response.json({ error: "Unable to submit the report." }, { status: 500 });
  }
}
