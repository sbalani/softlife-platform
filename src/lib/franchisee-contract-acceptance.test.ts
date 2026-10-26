import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTenantAcceptancePayload,
  canDownloadTenantAcceptance,
  validateTenantAcceptanceForm,
} from "./franchisee-contract-acceptance.ts";
import { canonicalJson, sha256Hex } from "./franchisee-onboarding-evidence.ts";
import { FRANCHISEE_CONTRACT_TEMPLATE_HASH, FRANCHISEE_CONTRACT_VERSION, type ContractPartyValues } from "./franchisee-onboarding-contract.ts";

const party: ContractPartyValues = {
  representativeName: "María López",
  representativeEmail: "maria@example.com",
  representativePhone: "+34 600 123 123",
  representativeTitle: "Administradora",
  legalEntityName: "Helados Centro, S.L.",
  taxId: "B12345678",
  registeredAddress: "Calle Mayor 1, Málaga",
  tradeName: "Helados Centro",
  installationAddress: "Avenida Andalucía 20, Málaga",
  accountHolderName: "Helados Centro, S.L.",
  iban: "ES9121000418450200051332",
  bicSwift: "CAIXESBBXXX",
  bankDetailsDeferred: false,
};

function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    representative_title: party.representativeTitle,
    representative_phone: party.representativePhone,
    typed_signature: " MARÍA  LÓPEZ ",
    accepted_terms: "yes",
    accepted_authority: "yes",
    accepted_evidence: "yes",
    ...overrides,
  })) data.set(key, value);
  return data;
}

test("tenant evidence pins exact v3 contract and canonical tenant/user identity", () => {
  assert.equal(FRANCHISEE_CONTRACT_VERSION, "SL-GESTOR-2026-10-26-v3");
  assert.equal(FRANCHISEE_CONTRACT_TEMPLATE_HASH, "1bcedd5dfba2b85600dae517477171800ebab54b6626677f6cf3a3beefc4e8b5");
  const payload = buildTenantAcceptancePayload(
    { ...party, typedSignature: party.representativeName },
    { tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    "2026-10-26T11:00:00.000Z",
    { ipAuditHash: "d".repeat(64), userAgent: "test-agent" },
  );
  assert.deepEqual(payload.identity, { tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
  assert.equal(payload.contract.version, "SL-GESTOR-2026-10-26-v3");
  assert.equal(payload.contract.templateHash, FRANCHISEE_CONTRACT_TEMPLATE_HASH);
  assert.equal(sha256Hex(canonicalJson(payload)), "692201d2c3287665001faabfbe8a16ab80fa6e2edf4b557feaa6dee2d01e0d20");
});

test("tenant acceptance validates only signer fields, declarations, signature, and fallback installation address", () => {
  const derived = validateTenantAcceptanceForm(form(), party.representativeName, party.installationAddress);
  assert.equal(derived.success, true);
  const entered = validateTenantAcceptanceForm(form({ installation_address: party.installationAddress }), party.representativeName, null);
  assert.equal(entered.success, true);
  assert.equal(validateTenantAcceptanceForm(form({ typed_signature: "Otra Persona" }), party.representativeName, party.installationAddress).success, false);
  assert.equal(validateTenantAcceptanceForm(form({ representative_phone: "bad" }), party.representativeName, party.installationAddress).success, false);
  const missingDeclaration = form();
  missingDeclaration.delete("accepted_authority");
  assert.equal(validateTenantAcceptanceForm(missingDeclaration, party.representativeName, party.installationAddress).success, false);
  assert.equal(validateTenantAcceptanceForm(form(), party.representativeName, null).success, false);
});

test("contract download authorization permits only admins and the owning tenant", () => {
  const acceptance = { tenant_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  assert.equal(canDownloadTenantAcceptance({ id: "1", role: "admin", tenant_id: null }, acceptance), true);
  assert.equal(canDownloadTenantAcceptance({ id: "2", role: "franchisee", tenant_id: acceptance.tenant_id }, acceptance), true);
  assert.equal(canDownloadTenantAcceptance({ id: "3", role: "franchisee", tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, acceptance), false);
  assert.equal(canDownloadTenantAcceptance({ id: "4", role: "operator", tenant_id: acceptance.tenant_id }, acceptance), false);
  assert.equal(canDownloadTenantAcceptance(null, acceptance), false);
});
