import { isValidBic, isValidIban, normalizeBic, normalizeIban } from "./bank-details.ts";
import type { ContractPartyValues } from "./franchisee-onboarding-contract.ts";

export type OnboardingAcceptanceInput = ContractPartyValues & {
  typedSignature: string;
  acceptedTerms: boolean;
  acceptedAuthority: boolean;
  acceptedEvidence: boolean;
};

export type OnboardingValidationResult =
  | { success: true; data: OnboardingAcceptanceInput }
  | { success: false; error: string };

export function normalizeSignatureName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es-ES");
}

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim().replace(/\s+/g, " ");

export function validateOnboardingForm(data: FormData): OnboardingValidationResult {
  const bankDetailsDeferred = data.get("bank_details_deferred") === "yes";
  const accountHolderName = text(data, "account_holder_name");
  const iban = normalizeIban(text(data, "iban"));
  const bicSwift = normalizeBic(text(data, "bic_swift"));
  const input = {
    representativeName: text(data, "representative_name"),
    representativeEmail: text(data, "representative_email").toLowerCase(),
    representativePhone: text(data, "representative_phone"),
    representativeTitle: text(data, "representative_title"),
    legalEntityName: text(data, "legal_entity_name"),
    taxId: text(data, "tax_id").toUpperCase(),
    registeredAddress: text(data, "registered_address"),
    tradeName: text(data, "trade_name") || null,
    installationAddress: text(data, "installation_address"),
    accountHolderName: bankDetailsDeferred ? null : accountHolderName || null,
    iban: bankDetailsDeferred ? null : iban || null,
    bicSwift: bankDetailsDeferred ? null : bicSwift || null,
    bankDetailsDeferred,
    typedSignature: text(data, "typed_signature"),
    acceptedTerms: data.get("accepted_terms") === "yes",
    acceptedAuthority: data.get("accepted_authority") === "yes",
    acceptedEvidence: data.get("accepted_evidence") === "yes",
  };

  const required = [input.representativeName, input.representativeEmail, input.representativePhone, input.representativeTitle, input.legalEntityName, input.taxId, input.registeredAddress, input.installationAddress];
  if (required.some((item) => !item)) return { success: false, error: "Completa todos los campos obligatorios." };
  if ([input.representativeName, input.representativeTitle, input.legalEntityName, input.tradeName, accountHolderName].some((item) => item && item.length > 150)) return { success: false, error: "Uno o más campos superan la longitud permitida." };
  if (input.registeredAddress.length > 500 || input.installationAddress.length > 500 || input.taxId.length > 50) return { success: false, error: "Uno o más campos superan la longitud permitida." };
  if (input.representativeEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.representativeEmail)) return { success: false, error: "Introduce un email válido." };
  if (!/^[+()\d\s.-]{6,40}$/.test(input.representativePhone)) return { success: false, error: "Introduce un teléfono válido." };
  if (bankDetailsDeferred && (accountHolderName || iban || bicSwift)) return { success: false, error: "Para aplazar los datos bancarios, deja vacíos el titular, IBAN y BIC/SWIFT." };
  if (!bankDetailsDeferred && (!accountHolderName || !iban)) return { success: false, error: "Facilita el titular y un IBAN válido, o indica que aportarás los datos bancarios más adelante." };
  if (!bankDetailsDeferred && !isValidIban(iban)) return { success: false, error: "Introduce un IBAN válido." };
  if (!bankDetailsDeferred && bicSwift && !isValidBic(bicSwift)) return { success: false, error: "Introduce un BIC/SWIFT válido." };
  if (!input.acceptedTerms) return { success: false, error: "Debes revisar y aceptar todas las condiciones del contrato." };
  if (!input.acceptedAuthority) return { success: false, error: "Debes declarar que tienes facultades para obligar a la entidad." };
  if (!input.acceptedEvidence) return { success: false, error: "Debes aceptar la evidencia electrónica y la entrega del PDF." };
  if (normalizeSignatureName(input.typedSignature) !== normalizeSignatureName(input.representativeName)) return { success: false, error: "La firma escrita debe coincidir exactamente con el nombre del representante." };

  return { success: true, data: input };
}
