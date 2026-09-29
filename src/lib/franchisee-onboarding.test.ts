import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  FRANCHISEE_CONTRACT_TEMPLATE_HASH,
  FRANCHISEE_CONTRACT_TEMPLATE_SOURCE,
  FRANCHISEE_CONTRACT_VERSION,
  contractPlainText,
  renderFranchiseeContract,
  type ContractPartyValues,
} from "./franchisee-onboarding-contract.ts";
import { buildCanonicalPayload, canonicalJson, createDownloadToken, hashAuditIp, sha256Hex, tokenMatches } from "./franchisee-onboarding-evidence.ts";
import { createOnboardingContractPdf } from "./franchisee-onboarding-pdf.ts";
import { normalizeSignatureName, validateOnboardingForm } from "./franchisee-onboarding-validation.ts";

const party: ContractPartyValues = {
  representativeName: "María   López",
  representativeEmail: "maria@example.com",
  representativePhone: "+34 600 123 123",
  representativeTitle: "Administradora",
  legalEntityName: "Helados Centro, S.L.",
  taxId: "B12345678",
  registeredAddress: "Calle Mayor 1, 29001 Málaga",
  tradeName: "Helados Centro",
  installationAddress: "Avenida Andalucía 20, Local 4, 29007 Málaga",
  accountHolderName: "Helados Centro, S.L.",
  iban: "ES9121000418450200051332",
  bicSwift: "CAIXESBBXXX",
  modality: "A",
};

function validForm(overrides: Record<string, string | undefined> = {}): FormData {
  const values: Record<string, string> = {
    representative_name: party.representativeName,
    representative_email: party.representativeEmail,
    representative_phone: party.representativePhone,
    representative_title: party.representativeTitle,
    legal_entity_name: party.legalEntityName,
    tax_id: party.taxId,
    registered_address: party.registeredAddress,
    trade_name: party.tradeName ?? "",
    installation_address: party.installationAddress,
    account_holder_name: party.accountHolderName,
    iban: party.iban,
    bic_swift: party.bicSwift ?? "",
    modality: party.modality,
    typed_signature: "  MARÍA LÓPEZ ",
    accepted_terms: "yes",
    accepted_authority: "yes",
    accepted_evidence: "yes",
    ...Object.fromEntries(Object.entries(overrides).filter((entry): entry is [string, string] => entry[1] !== undefined)),
  };
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) if (overrides[key] !== undefined || !(key in overrides)) form.set(key, value);
  return form;
}

test("versioned Spanish contract contains the required commercial and annex terms", () => {
  const modeA = contractPlainText(renderFranchiseeContract(party, "2026-09-29T12:34:56.000Z"));
  assert.match(modeA, /MÁQUINA es propiedad exclusiva y permanente de SOFTLIFE/);
  assert.match(modeA, /garantizar de forma constante la disponibilidad y el adelanto de la materia prima/);
  assert.match(modeA, /MODALIDAD A - GESTIÓN TOTAL POR EL GESTOR \(26 %\)/);
  assert.match(modeA, /26 % de la facturación neta/);
  assert.match(modeA, /transferencia bancaria o ingreso bancario/);
  assert.match(modeA, /No se realizarán pagos en efectivo/);
  assert.match(modeA, /diez \(10\) días hábiles/);
  assert.match(modeA, /control telemático en tiempo real/);
  assert.match(modeA, /promoción y el marketing de la MÁQUINA/);
  assert.match(modeA, /duración de un \(1\) año/);
  assert.match(modeA, /treinta \(30\) días/);
  assert.match(modeA, /juzgados y tribunales de Málaga/);
  assert.match(modeA, /volumen de ventas, facturación, días de operación, regularidad/);
  assert.match(modeA, /boquillas externas de salida[\s\S]*cada día de operación/);
  assert.match(modeA, /Modelo de la MÁQUINA: pendiente de asignación[\s\S]*acta de instalación\/entrega/);
  assert.match(modeA, /facturación por el destinatario/);

  const modeB = contractPlainText(renderFranchiseeContract({ ...party, modality: "B" }, "2026-09-29T12:34:56.000Z"));
  assert.match(modeB, /\[X\] MODALIDAD B - GESTIÓN DE REPOSICIÓN POR SOFTLIFE \(18 %\)/);
});

test("template hash and canonical payload are stable", () => {
  assert.equal(sha256Hex(FRANCHISEE_CONTRACT_TEMPLATE_SOURCE), FRANCHISEE_CONTRACT_TEMPLATE_HASH);
  const payload = buildCanonicalPayload({ ...party, typedSignature: party.representativeName }, "79b69771-6d3c-43fd-b068-d11e2b2fa9dc", "2026-09-29T12:34:56.000Z", { ipAuditHash: "a".repeat(64), userAgent: "test-agent" });
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(canonicalJson(payload), canonicalJson(reordered));
  assert.equal(sha256Hex(canonicalJson(payload)), "1163789e09d62c3d37ecdd337383917d2759ab88ac10f45e1158db5af6c3c888");
});

test("validation requires modality, valid bank details, declarations, and matching typed name", () => {
  assert.equal(validateOnboardingForm(validForm()).success, true);
  assert.equal(normalizeSignatureName(" María   LÓPEZ "), normalizeSignatureName("maría lópez"));
  for (const [field, value] of [
    ["modality", undefined],
    ["iban", "ES000000"],
    ["accepted_terms", undefined],
    ["accepted_authority", undefined],
    ["accepted_evidence", undefined],
    ["typed_signature", "Otra Persona"],
  ] as const) {
    assert.equal(validateOnboardingForm(validForm({ [field]: value })).success, false, `${field} should be rejected`);
  }
});

test("PDF is loadable, metadata-bearing, and hashed", async () => {
  const payload = buildCanonicalPayload({ ...party, typedSignature: party.representativeName }, "79b69771-6d3c-43fd-b068-d11e2b2fa9dc", "2026-09-29T12:34:56.000Z", { ipAuditHash: "a".repeat(64), userAgent: "test-agent" });
  const sourceHash = sha256Hex(canonicalJson(payload));
  const generated = await createOnboardingContractPdf(payload, sourceHash);
  assert.equal(new TextDecoder().decode(generated.bytes.slice(0, 5)), "%PDF-");
  assert.equal(generated.hash, sha256Hex(generated.bytes));
  const loaded = await PDFDocument.load(generated.bytes);
  assert.match(loaded.getTitle() ?? "", new RegExp(payload.acceptanceId));
  assert.match(loaded.getSubject() ?? "", new RegExp(FRANCHISEE_CONTRACT_VERSION));
  assert.ok(loaded.getPageCount() >= 2);
});

test("download token hashes are one-way and compared exactly", () => {
  const first = createDownloadToken();
  const second = createDownloadToken();
  assert.equal(first.token.length, 43);
  assert.equal(first.hash.length, 64);
  assert.equal(tokenMatches(first.token, first.hash), true);
  assert.equal(tokenMatches(second.token, first.hash), false);
  assert.equal(tokenMatches("invalid", first.hash), false);
  assert.equal(hashAuditIp(" 203.0.113.5 ", "x".repeat(32)), hashAuditIp("203.0.113.5", "x".repeat(32)));
});
