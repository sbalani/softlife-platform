import { isSameOrigin, publicReportContact } from "@/lib/public-reporting";
import { newSubmissionToken, requestIpHash, submissionTokenHash } from "@/lib/public-reporting-crypto";
import { validUuid } from "@/lib/public-reporting-server";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return Response.json({ error: "Reporting is temporarily unavailable." }, { status: 503 });
  if (!isSameOrigin(request)) return Response.json({ error: "Invalid request." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const contact = publicReportContact(body);
    if ("error" in contact) return Response.json({ error: contact.error }, { status: 400 });
    if (!validUuid(body.machine_id)) return Response.json({ error: "Select a machine." }, { status: 400 });
    const token = newSubmissionToken();
    const { data, error } = await (await createServiceClient()).rpc("create_public_incident_draft", {
      p_token_hash: submissionTokenHash(token),
      p_ip_hash: requestIpHash(request),
      p_machine_id: body.machine_id,
      p_reporter_name: contact.reporterName,
      p_phone: contact.phone,
      p_email: contact.email,
      p_explanation: contact.explanation,
    });
    if (error) {
      const throttled = error.message.includes("Too many reports");
      return Response.json({ error: throttled ? error.message : "Unable to create the report." }, { status: throttled ? 429 : 400 });
    }
    return Response.json({ submission_id: data, token }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[public-incident-draft]", error);
    return Response.json({ error: "Unable to create the report." }, { status: 500 });
  }
}
