"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getSessionProfile } from "@/lib/auth/session";
import { bankDetailsFromForm } from "@/lib/bank-details";
import { createServiceClient } from "@/lib/supabase/server";
import { getCurrentTenantContractAcceptance } from "@/lib/data/franchisee-contract-acceptances";
import { getTenantBankDetails, getTenantById, getTenantContractInstallationAddress, tenantPostalAddress } from "@/lib/data/franchisees";
import { buildTenantAcceptancePayload, validateTenantAcceptanceForm } from "@/lib/franchisee-contract-acceptance";
import { canonicalJson, hashAuditIp, sha256Hex } from "@/lib/franchisee-onboarding-evidence";
import { FRANCHISEE_CONTRACT_VERSION } from "@/lib/franchisee-onboarding-contract";
import { createOnboardingContractPdf } from "@/lib/franchisee-onboarding-pdf";

export type AccountResult = { ok: boolean; error?: string };
export type ContractAcceptanceResult = { ok: boolean; error?: string; downloadUrl?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[+()\d\s.-]{6,40}$/;

function optional(formData: FormData, name: string, max: number) {
  const value = String(formData.get(name) ?? "").trim();
  if (value.length > max) throw new Error(`${name.replaceAll("_", " ")} is too long.`);
  return value || null;
}

async function ownFranchisee() {
  const session = await getSessionProfile();
  return session?.role === "franchisee" && session.tenant_id ? session : null;
}

function requestIp(requestHeaders: Headers): string {
  return (requestHeaders.get("cf-connecting-ip")
    ?? requestHeaders.get("x-vercel-forwarded-for")
    ?? requestHeaders.get("x-forwarded-for")?.split(",")[0]
    ?? requestHeaders.get("x-real-ip")
    ?? "unavailable").trim();
}

function revalidateAccount() {
  revalidatePath("/account");
  revalidatePath("/dashboard");
  revalidatePath("/analytics");
  revalidatePath("/", "layout");
}

export async function saveOwnCompanyDetails(_previous: AccountResult | null, formData: FormData): Promise<AccountResult> {
  const session = await ownFranchisee();
  if (!session) return { ok: false, error: "Franchisee access required." };
  try {
    const values = {
      company_name: optional(formData, "company_name", 150),
      tax_id: optional(formData, "tax_id", 50),
      contact_email: optional(formData, "contact_email", 254),
      contact_phone: optional(formData, "contact_phone", 40),
      website: optional(formData, "website", 300),
      address_line_1: optional(formData, "address_line_1", 200),
      address_line_2: optional(formData, "address_line_2", 200),
      postal_code: optional(formData, "postal_code", 20),
      city: optional(formData, "city", 100),
      province: optional(formData, "province", 100),
      country: optional(formData, "country", 100),
    };
    if (values.contact_email && !EMAIL.test(values.contact_email)) return { ok: false, error: "Enter a valid email." };
    if (values.contact_phone && !PHONE.test(values.contact_phone)) return { ok: false, error: "Enter a valid phone number." };
    if (values.website) {
      const url = new URL(values.website);
      if (!new Set(["http:", "https:"]).has(url.protocol)) return { ok: false, error: "Website must use HTTP or HTTPS." };
    }
    const { data, error } = await (await createServiceClient()).from("tenants").update(values)
      .eq("id", session.tenant_id).eq("kind", "franchisee").select("id").maybeSingle();
    if (error) throw error;
    if (!data) return { ok: false, error: "Franchisee account not found." };
    revalidateAccount();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save company details." };
  }
}

export async function saveOwnBankDetails(_previous: AccountResult | null, formData: FormData): Promise<AccountResult> {
  const session = await ownFranchisee();
  if (!session) return { ok: false, error: "Franchisee access required." };
  const parsed = bankDetailsFromForm(formData);
  if (parsed.error || !parsed.details) return { ok: false, error: parsed.error ?? "Enter the bank details." };
  const { details } = parsed;
  const { error } = await (await createServiceClient()).from("tenant_bank_details").upsert({
    tenant_id: session.tenant_id,
    account_holder_name: details.accountHolderName,
    iban: details.iban,
    bic_swift: details.bicSwift,
    bank_name: details.bankName,
    updated_at: new Date().toISOString(),
    updated_by: session.id,
  });
  if (error) return { ok: false, error: "Could not save bank details." };
  revalidateAccount();
  return { ok: true };
}

export async function acceptCurrentContract(_previous: ContractAcceptanceResult | null, formData: FormData): Promise<ContractAcceptanceResult> {
  const session = await ownFranchisee();
  if (!session) return { ok: false, error: "Se requiere acceso de gestor." };
  const tenantId = session.tenant_id!;
  let storagePath: string | null = null;
  try {
    const existing = await getCurrentTenantContractAcceptance(tenantId);
    if (existing) return { ok: true, downloadUrl: `/account/contract/${existing.id}/pdf` };

    const [tenant, bank] = await Promise.all([getTenantById(tenantId), getTenantBankDetails(tenantId)]);
    if (!tenant || tenant.kind !== "franchisee") return { ok: false, error: "No se encontró la cuenta del gestor." };
    const registeredAddress = tenantPostalAddress(tenant);
    if (!tenant.company_name || !tenant.tax_id || !bank?.account_holder_name || !bank.iban || !registeredAddress) {
      return { ok: false, error: "Completa primero los datos legales, fiscales, de dirección y bancarios de la cuenta." };
    }
    if (!session.full_name || !session.email) return { ok: false, error: "Tu perfil debe tener nombre completo y email antes de aceptar." };
    const derivedInstallationAddress = await getTenantContractInstallationAddress(tenant);
    const validated = validateTenantAcceptanceForm(formData, session.full_name, derivedInstallationAddress);
    if (!validated.success) return { ok: false, error: validated.error };

    const hmacSecret = process.env.ONBOARDING_AUDIT_HMAC_SECRET
      || process.env.PUBLIC_REPORT_HASH_SECRET
      || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!hmacSecret) return { ok: false, error: "La aceptación no está disponible temporalmente." };

    const acceptedAt = new Date().toISOString();
    const acceptanceId = crypto.randomUUID();
    const requestHeaders = await headers();
    const ipAuditHash = hashAuditIp(requestIp(requestHeaders), hmacSecret);
    const userAgent = (requestHeaders.get("user-agent") || "unavailable").trim().replace(/\s+/g, " ").slice(0, 500);
    const input = {
      representativeName: session.full_name,
      representativeEmail: session.email,
      representativePhone: validated.data.representativePhone,
      representativeTitle: validated.data.representativeTitle,
      legalEntityName: tenant.company_name,
      taxId: tenant.tax_id,
      registeredAddress,
      tradeName: tenant.name === tenant.company_name ? null : tenant.name,
      installationAddress: validated.data.installationAddress!,
      accountHolderName: bank.account_holder_name,
      iban: bank.iban,
      bicSwift: bank.bic_swift,
      bankDetailsDeferred: false,
      typedSignature: validated.data.typedSignature,
    };
    const payload = buildTenantAcceptancePayload(input, { tenantId, userId: session.id }, acceptanceId, acceptedAt, { ipAuditHash, userAgent });
    const sourceHash = sha256Hex(canonicalJson(payload));
    const pdf = await createOnboardingContractPdf(payload, sourceHash);
    storagePath = `tenants/${tenantId}/${acceptanceId}/${pdf.hash}.pdf`;
    const service = await createServiceClient();
    const { error: uploadError } = await service.storage.from("onboarding-contract-evidence").upload(storagePath, pdf.bytes, { contentType: "application/pdf", upsert: false });
    if (uploadError) throw uploadError;
    const { error: insertError } = await service.from("franchisee_contract_acceptances").insert({
      id: acceptanceId,
      tenant_id: tenantId,
      profile_id: session.id,
      accepted_at: acceptedAt,
      contract_version: FRANCHISEE_CONTRACT_VERSION,
      contract_template_hash: payload.contract.templateHash,
      canonical_source: payload,
      canonical_source_sha256: sourceHash,
      pdf_storage_path: storagePath,
      pdf_sha256: pdf.hash,
      ip_audit_hash: ipAuditHash,
      user_agent: userAgent,
    });
    if (insertError) {
      await service.storage.from("onboarding-contract-evidence").remove([storagePath]);
      storagePath = null;
      if (insertError.code === "23505") {
        const duplicate = await getCurrentTenantContractAcceptance(tenantId);
        if (duplicate) return { ok: true, downloadUrl: `/account/contract/${duplicate.id}/pdf` };
      }
      throw insertError;
    }
    revalidatePath("/account");
    revalidatePath("/payouts");
    return { ok: true, downloadUrl: `/account/contract/${acceptanceId}/pdf` };
  } catch (error) {
    if (storagePath) {
      try { await (await createServiceClient()).storage.from("onboarding-contract-evidence").remove([storagePath]); } catch { /* Best-effort cleanup preserves the original error. */ }
    }
    console.error("[account] Contract acceptance failed:", error);
    return { ok: false, error: "No se pudo registrar la aceptación. No se ha guardado ninguna aceptación; inténtalo de nuevo." };
  }
}
