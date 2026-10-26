import {
  ACCEPTANCE_DECLARATION,
  ACCEPT_BUTTON_LABEL,
  AUTHORITY_DECLARATION,
  EVIDENCE_DECLARATION,
  FRANCHISEE_CONTRACT_TEMPLATE_HASH,
  FRANCHISEE_CONTRACT_VERSION,
  type ContractPartyValues,
} from "./franchisee-onboarding-contract.ts";
import { normalizeSignatureName } from "./franchisee-onboarding-validation.ts";

export const FRANCHISEE_CONTRACT_ACCEPTANCE_DEADLINE = "2026-11-14";

export type TenantContractAcceptancePayload = {
  schemaVersion: 1;
  acceptanceId: string;
  acceptedAt: string;
  contract: { version: typeof FRANCHISEE_CONTRACT_VERSION; templateHash: typeof FRANCHISEE_CONTRACT_TEMPLATE_HASH; bindingLanguage: "es" };
  identity: { tenantId: string; userId: string };
  manager: ContractPartyValues & { modality: null; sharePercent: null };
  signer: { name: string; title: string; email: string; phone: string; typedSignature: string };
  declarations: {
    terms: { accepted: true; wording: string };
    authority: { accepted: true; wording: string };
    evidence: { accepted: true; wording: string };
    buttonLabel: string;
  };
  audit: { ipAuditHash: string; userAgent: string };
};

export type TenantAcceptanceFormInput = {
  representativeTitle: string;
  representativePhone: string;
  typedSignature: string;
  installationAddress: string | null;
};

export type TenantAcceptanceValidationResult =
  | { success: true; data: TenantAcceptanceFormInput }
  | { success: false; error: string };

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim().replace(/\s+/g, " ");

export function validateTenantAcceptanceForm(data: FormData, signerName: string, derivedInstallationAddress: string | null): TenantAcceptanceValidationResult {
  const representativeTitle = text(data, "representative_title");
  const representativePhone = text(data, "representative_phone");
  const typedSignature = text(data, "typed_signature");
  const installationAddress = derivedInstallationAddress?.trim() || text(data, "installation_address") || null;
  if (!representativeTitle || representativeTitle.length > 150) return { success: false, error: "Indica tu cargo o capacidad de representación." };
  if (!/^[+()\d\s.-]{6,40}$/.test(representativePhone)) return { success: false, error: "Introduce un teléfono válido." };
  if (!installationAddress || installationAddress.length > 500) return { success: false, error: "Introduce una dirección de instalación válida." };
  if (data.get("accepted_terms") !== "yes" || data.get("accepted_authority") !== "yes" || data.get("accepted_evidence") !== "yes") {
    return { success: false, error: "Debes marcar las tres declaraciones para aceptar el contrato." };
  }
  if (normalizeSignatureName(typedSignature) !== normalizeSignatureName(signerName)) {
    return { success: false, error: "La firma escrita debe coincidir exactamente con tu nombre de perfil." };
  }
  return { success: true, data: { representativeTitle, representativePhone, typedSignature, installationAddress } };
}

export function buildTenantAcceptancePayload(
  input: ContractPartyValues & { typedSignature: string },
  identity: TenantContractAcceptancePayload["identity"],
  acceptanceId: string,
  acceptedAt: string,
  audit: TenantContractAcceptancePayload["audit"],
): TenantContractAcceptancePayload {
  return {
    schemaVersion: 1,
    acceptanceId,
    acceptedAt,
    contract: { version: FRANCHISEE_CONTRACT_VERSION, templateHash: FRANCHISEE_CONTRACT_TEMPLATE_HASH, bindingLanguage: "es" },
    identity,
    manager: { ...input, modality: null, sharePercent: null },
    signer: {
      name: input.representativeName,
      title: input.representativeTitle,
      email: input.representativeEmail,
      phone: input.representativePhone,
      typedSignature: input.typedSignature,
    },
    declarations: {
      terms: { accepted: true, wording: ACCEPTANCE_DECLARATION },
      authority: { accepted: true, wording: AUTHORITY_DECLARATION },
      evidence: { accepted: true, wording: EVIDENCE_DECLARATION },
      buttonLabel: ACCEPT_BUTTON_LABEL,
    },
    audit,
  };
}

export function canDownloadTenantAcceptance(
  session: { id: string; role: string; tenant_id: string | null } | null,
  acceptance: { tenant_id: string },
): boolean {
  return Boolean(session && (session.role === "admin" || (session.role === "franchisee" && session.tenant_id === acceptance.tenant_id)));
}
