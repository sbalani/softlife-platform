import assert from "node:assert/strict";
import test from "node:test";
import { isValidBic, isValidIban, maskIban, normalizeIban, payoutMissingFields } from "./bank-details.ts";

test("IBAN validation normalizes spacing and checks mod 97", () => {
  assert.equal(normalizeIban("es91 2100 0418 4502 0005 1332"), "ES9121000418450200051332");
  assert.equal(isValidIban("ES91 2100 0418 4502 0005 1332"), true);
  assert.equal(isValidIban("ES91 2100 0418 4502 0005 1333"), false);
});

test("payout readiness requires company, tax ID, and bank account", () => {
  assert.deepEqual(payoutMissingFields({ companyName: null, taxId: "", hasBankAccount: false }), ["company", "tax", "bank"]);
  assert.deepEqual(payoutMissingFields({ companyName: "Autónomo Name", taxId: "123", hasBankAccount: true }), []);
});

test("BIC validation and IBAN masking avoid exposing the full account", () => {
  assert.equal(isValidBic("CAIXESBBXXX"), true);
  assert.equal(isValidBic("bad"), false);
  assert.equal(maskIban("ES9121000418450200051332"), "ES91 •••• •••• 1332");
});
