import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ACCEPTANCE_DECLARATION,
  ACCEPT_BUTTON_LABEL,
  AUTHORITY_DECLARATION,
  EVIDENCE_DECLARATION,
  FRANCHISEE_CONTRACT_TEMPLATE_HASH,
  FRANCHISEE_CONTRACT_VERSION,
  type ContractPartyValues,
} from "./franchisee-onboarding-contract.ts";

export type OnboardingCanonicalPayload = {
  schemaVersion: 1;
  acceptanceId: string;
  acceptedAt: string;
  contract: { version: string; templateHash: string; bindingLanguage: "es" };
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

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashAuditIp(ip: string, secret: string): string {
  if (secret.length < 32) throw new Error("ONBOARDING_AUDIT_HMAC_SECRET must contain at least 32 characters");
  return createHmac("sha256", secret).update(ip.trim().toLowerCase()).digest("hex");
}

export function createDownloadToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: sha256Hex(token) };
}

export function tokenMatches(token: string, expectedHash: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(sha256Hex(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildCanonicalPayload(
  input: ContractPartyValues & { typedSignature: string },
  acceptanceId: string,
  acceptedAt: string,
  audit: OnboardingCanonicalPayload["audit"],
): OnboardingCanonicalPayload {
  return {
    schemaVersion: 1,
    acceptanceId,
    acceptedAt,
    contract: { version: FRANCHISEE_CONTRACT_VERSION, templateHash: FRANCHISEE_CONTRACT_TEMPLATE_HASH, bindingLanguage: "es" },
    manager: {
      representativeName: input.representativeName,
      representativeEmail: input.representativeEmail,
      representativePhone: input.representativePhone,
      representativeTitle: input.representativeTitle,
      legalEntityName: input.legalEntityName,
      taxId: input.taxId,
      registeredAddress: input.registeredAddress,
      tradeName: input.tradeName,
      installationAddress: input.installationAddress,
      accountHolderName: input.accountHolderName,
      iban: input.iban,
      bicSwift: input.bicSwift,
      bankDetailsDeferred: input.bankDetailsDeferred,
      modality: null,
      sharePercent: null,
    },
    signer: { name: input.representativeName, title: input.representativeTitle, email: input.representativeEmail, phone: input.representativePhone, typedSignature: input.typedSignature },
    declarations: {
      terms: { accepted: true, wording: ACCEPTANCE_DECLARATION },
      authority: { accepted: true, wording: AUTHORITY_DECLARATION },
      evidence: { accepted: true, wording: EVIDENCE_DECLARATION },
      buttonLabel: ACCEPT_BUTTON_LABEL,
    },
    audit,
  };
}
