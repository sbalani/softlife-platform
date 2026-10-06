import { createServiceClient } from "@/lib/supabase/server";
import { translateLocation } from "@/lib/i18n/huaxin";
import type { Locale } from "@/lib/i18n/locale";
import { submissionBearer } from "@/lib/public-reporting";
import { submissionTokenHash } from "@/lib/public-reporting-crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export async function listPublicReportMachines(locale: Locale) {
  const { data, error } = await (await createServiceClient())
    .from("machines")
    .select("id,name,display_name,location,location_override")
    .eq("deployed", true)
    .order("display_name")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((machine) => {
    const name = String(machine.display_name || machine.name || (locale === "es" ? "Máquina" : "Machine"));
    const location = machine.location_override || translateLocation(machine.location);
    return { id: machine.id as string, label: location ? `${name} · ${location}` : name };
  });
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
