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
  bankDetailsDeferred: false,
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
    account_holder_name: party.accountHolderName ?? "",
    iban: party.iban ?? "",
    bic_swift: party.bicSwift ?? "",
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

test("versioned Spanish contract contains both SoftLife-assigned modes and required payment terms", () => {
  const contract = contractPlainText(renderFranchiseeContract(party, "2026-09-29T12:34:56.000Z"));
  assert.match(contract, /MÁQUINA es propiedad exclusiva y permanente de SOFTLIFE/);
  assert.match(contract, /garantizar de forma constante la disponibilidad y el adelanto de la materia prima/);
  assert.match(contract, /MODALIDAD A - GESTIÓN TOTAL POR EL GESTOR \(26 %\)/);
  assert.match(contract, /MODALIDAD B - GESTIÓN DE REPOSICIÓN POR SOFTLIFE \(18 %\)/);
  assert.match(contract, /asignación de la Modalidad A o B corresponde exclusivamente a SOFTLIFE/);
  assert.match(contract, /El GESTOR no elige modalidad mediante esta aceptación/);
  assert.match(contract, /antes de la instalación y del inicio de la operación/);
  assert.match(contract, /acta de instalación\/entrega posterior firmada por ambas partes/);
  assert.match(contract, /transferencia bancaria o ingreso bancario/);
  assert.match(contract, /No se realizarán pagos en efectivo/);
  assert.match(contract, /diez \(10\) días hábiles/);
  assert.match(contract, /control telemático en tiempo real/);
  assert.match(contract, /promoción y el marketing de la MÁQUINA/);
  assert.match(contract, /duración de un \(1\) año/);
  assert.match(contract, /treinta \(30\) días/);
  assert.match(contract, /juzgados y tribunales de Málaga/);
  assert.match(contract, /volumen de ventas, facturación, días de operación, regularidad/);
  assert.match(contract, /boquillas externas de salida[\s\S]*cada día de operación/);
  assert.match(contract, /Modelo de la MÁQUINA: pendiente de asignación[\s\S]*modalidad y el porcentaje asignados exclusivamente por SOFTLIFE/);
  assert.match(contract, /facturación por el destinatario/);

  const deferred = contractPlainText(renderFranchiseeContract({ ...party, accountHolderName: null, iban: null, bicSwift: null, bankDetailsDeferred: true }));
  assert.match(deferred, /datos bancarios quedan pendientes de aportación/);
  assert.match(deferred, /incorporación y aceptación del GESTOR pueden continuar/);
  assert.match(deferred, /no podrá realizar ningún pago de participación en ingresos hasta que el GESTOR facilite datos bancarios completos y válidos/);
  assert.match(deferred, /exclusivamente mediante transferencia bancaria o ingreso bancario y nunca en efectivo/);
});

test("template hash and canonical payload are stable", () => {
  assert.equal(sha256Hex(FRANCHISEE_CONTRACT_TEMPLATE_SOURCE), FRANCHISEE_CONTRACT_TEMPLATE_HASH);
  const payload = buildCanonicalPayload({ ...party, typedSignature: party.representativeName }, "79b69771-6d3c-43fd-b068-d11e2b2fa9dc", "2026-09-29T12:34:56.000Z", { ipAuditHash: "a".repeat(64), userAgent: "test-agent" });
  const reordered = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(payload.manager.modality, null);
  assert.equal(payload.manager.sharePercent, null);
  assert.equal(payload.manager.bankDetailsDeferred, false);
  assert.equal(canonicalJson(payload), canonicalJson(reordered));
  assert.equal(sha256Hex(canonicalJson(payload)), "bfc256a77c6bf6f5b1d06ae725999f3b1ad6fa3aa071f03ae87bffa3c892dd0d");

  const deferred = buildCanonicalPayload({ ...party, accountHolderName: null, iban: null, bicSwift: null, bankDetailsDeferred: true, typedSignature: party.representativeName }, "79b69771-6d3c-43fd-b068-d11e2b2fa9dc", "2026-09-29T12:34:56.000Z", { ipAuditHash: "a".repeat(64), userAgent: "test-agent" });
  assert.equal(deferred.manager.accountHolderName, null);
  assert.equal(deferred.manager.iban, null);
  assert.equal(deferred.manager.bicSwift, null);
  assert.equal(sha256Hex(canonicalJson(deferred)), "79c3a9952711cb315cc43af09cfd7da1eb1cb4c6cde962ed25aece48fd0fd8c2");
});

test("validation ignores browser modality and accepts complete or explicitly deferred bank details", () => {
  const complete = validateOnboardingForm(validForm({ modality: "B" }));
  assert.equal(complete.success, true);
  assert.equal(complete.success && "modality" in complete.data, false);
  assert.equal(complete.success && complete.data.bankDetailsDeferred, false);

  const deferred = validateOnboardingForm(validForm({ account_holder_name: undefined, iban: undefined, bic_swift: undefined, bank_details_deferred: "yes", modality: "A" }));
  assert.equal(deferred.success, true);
  if (deferred.success) {
    assert.equal(deferred.data.accountHolderName, null);
    assert.equal(deferred.data.iban, null);
    assert.equal(deferred.data.bicSwift, null);
    assert.equal(deferred.data.bankDetailsDeferred, true);
    assert.equal("modality" in deferred.data, false);
  }
  assert.equal(normalizeSignatureName(" María   LÓPEZ "), normalizeSignatureName("maría lópez"));
  assert.equal(validateOnboardingForm(validForm({ account_holder_name: undefined, iban: undefined, bic_swift: undefined })).success, false);
  for (const [field, value] of [
    ["account_holder_name", undefined],
    ["iban", undefined],
    ["iban", "ES000000"],
    ["bic_swift", "INVALID"],
    ["accepted_terms", undefined],
    ["accepted_authority", undefined],
    ["accepted_evidence", undefined],
    ["typed_signature", "Otra Persona"],
  ] as const) {
    assert.equal(validateOnboardingForm(validForm({ [field]: value })).success, false, `${field} should be rejected`);
  }
  assert.equal(validateOnboardingForm(validForm({ account_holder_name: "Partial", iban: undefined })).success, false);
  assert.equal(validateOnboardingForm(validForm({ account_holder_name: undefined, iban: party.iban ?? "" })).success, false);
  assert.equal(validateOnboardingForm(validForm({ bank_details_deferred: "yes", iban: "ES000000" })).success, false);
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
