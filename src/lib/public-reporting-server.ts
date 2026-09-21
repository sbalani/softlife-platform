import { createServiceClient } from "@/lib/supabase/server";
import { submissionBearer } from "@/lib/public-reporting";
import { submissionTokenHash } from "@/lib/public-reporting-crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function authorizedPublicDraft(request: Request, submissionId: string) {
  const token = submissionBearer(request);
  if (!token || !validUuid(submissionId)) return null;
  const s = await createServiceClient();
  const { data, error } = await s.from("public_incident_submissions")
    .select("id,status,token_expires_at")
    .eq("id", submissionId)
    .eq("token_hash", submissionTokenHash(token))
    .gt("token_expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data || data.status !== "draft") return null;
  return { client: s, tokenHash: submissionTokenHash(token) };
}
