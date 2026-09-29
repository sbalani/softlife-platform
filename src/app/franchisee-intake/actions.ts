"use server";

import { headers } from "next/headers";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { validateOnboardingForm } from "@/lib/franchisee-onboarding-validation";
import { buildCanonicalPayload, canonicalJson, createDownloadToken, hashAuditIp, sha256Hex } from "@/lib/franchisee-onboarding-evidence";
import { createOnboardingContractPdf } from "@/lib/franchisee-onboarding-pdf";
import { FRANCHISEE_CONTRACT_VERSION } from "@/lib/franchisee-onboarding-contract";

export type FranchiseeIntakeResult =
  | { ok: false; error: string }
  | { ok: true; acceptanceId?: string; downloadUrl?: string };

const CONTRACT_BUCKET = "onboarding-contract-evidence";
const RATE_WINDOW_MS = 60 * 60 * 1000;
const IP_RATE_LIMIT = 5;
const EMAIL_RATE_LIMIT = 3;

function requestIp(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("cf-connecting-ip")
    ?? requestHeaders.get("x-vercel-forwarded-for")
    ?? requestHeaders.get("x-forwarded-for")?.split(",")[0]
    ?? requestHeaders.get("x-real-ip");
  return forwarded?.trim() || "unavailable";
}

export async function submitFranchiseeIntake(
  _previous: FranchiseeIntakeResult | null,
  formData: FormData,
): Promise<FranchiseeIntakeResult> {
  if (String(formData.get("website") ?? "").trim()) return { ok: true };
  const validated = validateOnboardingForm(formData);
  if (!validated.success) return { ok: false, error: validated.error };
  if (!isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, error: "El formulario no está disponible temporalmente." };

  const hmacSecret = process.env.ONBOARDING_AUDIT_HMAC_SECRET
    || process.env.PUBLIC_REPORT_HASH_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hmacSecret) return { ok: false, error: "El formulario no está disponible temporalmente." };

  const acceptedAt = new Date().toISOString();
  const acceptanceId = crypto.randomUUID();
  const input = validated.data;
  let ipAuditHash: string;
  let userAgent: string;
  try {
    const requestHeaders = await headers();
    ipAuditHash = hashAuditIp(requestIp(requestHeaders), hmacSecret);
    userAgent = (requestHeaders.get("user-agent") || "unavailable").trim().replace(/\s+/g, " ").slice(0, 500);
  } catch {
    return { ok: false, error: "El formulario no está disponible temporalmente." };
  }

  let storagePath: string | null = null;
  try {
    const s = await createServiceClient();
    const cutoff = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const [ipRecent, emailRecent] = await Promise.all([
      s.from("franchisee_intake_submissions").select("id", { count: "exact", head: true }).eq("ip_audit_hash", ipAuditHash).gte("accepted_at", cutoff),
      s.from("franchisee_intake_submissions").select("id", { count: "exact", head: true }).eq("contact_email", input.representativeEmail).gte("accepted_at", cutoff),
    ]);
    if (ipRecent.error || emailRecent.error) throw new Error("Rate-limit lookup failed");
    if ((ipRecent.count ?? 0) >= IP_RATE_LIMIT || (emailRecent.count ?? 0) >= EMAIL_RATE_LIMIT) {
      return { ok: false, error: "Demasiados intentos recientes. Espera una hora antes de volver a intentarlo." };
    }

    const payload = buildCanonicalPayload(input, acceptanceId, acceptedAt, { ipAuditHash, userAgent });
    const sourcePayload = canonicalJson(payload);
    const sourceHash = sha256Hex(sourcePayload);
    const pdf = await createOnboardingContractPdf(payload, sourceHash);
    const download = createDownloadToken();
    storagePath = `${acceptanceId}/${pdf.hash}.pdf`;
    const { error: uploadError } = await s.storage.from(CONTRACT_BUCKET).upload(storagePath, pdf.bytes, { contentType: "application/pdf", upsert: false });
    if (uploadError) throw uploadError;

    const { error: insertError } = await s.from("franchisee_intake_submissions").insert({
      id: acceptanceId,
      trade_name: input.tradeName,
      company_name: input.legalEntityName,
      contact_name: input.representativeName,
      contact_email: input.representativeEmail,
      contact_phone: input.representativePhone,
      tax_id: input.taxId,
      account_holder_name: input.accountHolderName,
      iban: input.iban,
      bic_swift: input.bicSwift,
      bank_details_deferred: input.bankDetailsDeferred,
      representative_title: input.representativeTitle,
      registered_address: input.registeredAddress,
      installation_address: input.installationAddress,
      modality: null,
      share_percent: null,
      accepted_at: acceptedAt,
      contract_version: FRANCHISEE_CONTRACT_VERSION,
      contract_template_hash: payload.contract.templateHash,
      canonical_source: payload,
      canonical_source_sha256: sourceHash,
      pdf_storage_path: storagePath,
      pdf_sha256: pdf.hash,
      download_token_sha256: download.hash,
      ip_audit_hash: ipAuditHash,
      user_agent: userAgent,
    });
    if (insertError) {
      await s.storage.from(CONTRACT_BUCKET).remove([storagePath]);
      storagePath = null;
      throw insertError;
    }
    return { ok: true, acceptanceId, downloadUrl: `/api/franchisee-intake-contract/${acceptanceId}?token=${encodeURIComponent(download.token)}` };
  } catch {
    if (storagePath) {
      try { await (await createServiceClient()).storage.from(CONTRACT_BUCKET).remove([storagePath]); } catch { /* Best effort: never hide the original failure. */ }
    }
    return { ok: false, error: "No se pudo aceptar el contrato. No se ha registrado ninguna aceptación; inténtalo de nuevo." };
  }
}
