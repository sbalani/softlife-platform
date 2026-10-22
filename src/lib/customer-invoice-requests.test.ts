import assert from "node:assert/strict";
import test from "node:test";
import { customerFiscalDetailsHash, parseCustomerFiscalDetails } from "./customer-invoice-requests.ts";

test("normalizes and hashes complete customer fiscal details", () => {
  const details = parseCustomerFiscalDetails({
    legal_name: " Customer SL ", tax_id: " b123 ", email: " BILLING@EXAMPLE.COM ",
    address: "Main 1", postal_code: "28001", city: "Madrid", province: "Madrid", country_code: "es",
  });
  assert.deepEqual(details, {
    legal_name: "Customer SL", tax_id: "B123", email: "billing@example.com", address: "Main 1",
    postal_code: "28001", city: "Madrid", province: "Madrid", country_code: "ES",
  });
  assert.match(customerFiscalDetailsHash(details), /^[0-9a-f]{64}$/);
});

test("pins the Unicode customer fiscal-details hash shared with PostgreSQL", () => {
  const details = parseCustomerFiscalDetails({
    legal_name: "  María Ñandú SL  ", tax_id: " bñ123 ", email: " FACTURACIÓN@EXAMPLE.COM ",
    address: "Calle Alcalá 42", postal_code: "28014", city: "A Coruña", province: "Cataluña", country_code: "es",
  });
  assert.equal(customerFiscalDetailsHash(details), "194074b5ce5a6bd18c7436fb1d15418afe4529e3b73a8e564fef0d633b5d301e");
});

test("rejects incomplete and invalid customer fiscal details", () => {
  assert.throws(() => parseCustomerFiscalDetails({}), /Legal name/);
  assert.throws(() => parseCustomerFiscalDetails({ legal_name: "A", tax_id: "X", email: "bad", address: "A", postal_code: "1", city: "C", province: "P", country_code: "ES" }), /valid email/);
});
