import assert from "node:assert/strict";
import test from "node:test";
import { buildPayoutSelfBillDraftPayload, buildPayoutSelfBillPdfPayload, buildPayoutSelfBillPostPayload, payoutSelfBillTaxBreakdown, spanishPayoutCountryCode, validatePayoutSelfBillResult } from "./payout-self-billing.ts";

const ids = {
  platformBillId: "11111111-1111-4111-8111-111111111111",
  settlementId: "22222222-2222-4222-8222-222222222222",
  tenantId: "33333333-3333-4333-8333-333333333333",
  contractAcceptanceId: "44444444-4444-4444-8444-444444444444",
};

test("gross payout already includes 21 percent IVA", () => {
  assert.deepEqual(payoutSelfBillTaxBreakdown(12_100), { grossCents: 12_100, taxBaseCents: 10_000, ivaCents: 2_100 });
  assert.deepEqual(payoutSelfBillTaxBreakdown(100), { grossCents: 100, taxBaseCents: 83, ivaCents: 17 });
});

test("draft payload is deterministic and validates exact result totals", () => {
  const built = buildPayoutSelfBillDraftPayload({
    ...ids, periodMonth: "2026-09", invoiceDate: "2026-09-30", grossCents: 12_100,
    sourceSnapshotSha256: "a".repeat(64),
    vendor: { legal_name: "Gestor SL", tax_id: "B12345678", email: "billing@example.com", address_line_1: "Calle Uno 1", address_line_2: null, postal_code: "29001", city: "Malaga", province: "Malaga", country_code: "ES" },
  });
  assert.equal(built.payload.bill.tax_base_cents, 10_000);
  assert.match(built.payload.bill.description, /facturación por el destinatario/);
  assert.doesNotThrow(() => validatePayoutSelfBillResult("payout_vendor_bill_draft_creation", built.payload, {
    accepted: true,
    bill: { platform_bill_id: ids.platformBillId, odoo_move_id: 1, odoo_partner_id: 2, odoo_journal_id: 3, payload_sha256: built.payloadSha256, state: "draft", created: true, amount_total_cents: 12_100 },
  }));
  assert.throws(() => validatePayoutSelfBillResult("payout_vendor_bill_draft_creation", built.payload, {
    accepted: true,
    bill: { platform_bill_id: ids.platformBillId, odoo_move_id: 1, odoo_partner_id: 2, odoo_journal_id: 3, payload_sha256: built.payloadSha256, state: "draft", created: true, amount_total_cents: 14_641 },
  }), /Invalid draft/);
});

test("Spanish payout country values normalize to the queue contract", () => {
  assert.equal(spanishPayoutCountryCode("Spain"), "ES");
  assert.equal(spanishPayoutCountryCode(" España "), "ES");
  assert.equal(spanishPayoutCountryCode("FR"), null);
});

test("post and PDF results remain bound to the original draft payload hash", () => {
  const originalHash = "b".repeat(64);
  const post = buildPayoutSelfBillPostPayload({ id: ids.platformBillId, odooMoveId: 12, payloadSha256: originalHash });
  assert.doesNotThrow(() => validatePayoutSelfBillResult("payout_vendor_bill_posting", post.payload, {
    accepted: true,
    bill: { platform_bill_id: ids.platformBillId, odoo_move_id: 12, payload_sha256: originalHash, state: "posted", name: "AF/2026/9", posted: false },
  }));
  const pdf = buildPayoutSelfBillPdfPayload({ id: ids.platformBillId, odooMoveId: 12, payloadSha256: originalHash, odooName: "AF/2026/9" });
  assert.doesNotThrow(() => validatePayoutSelfBillResult("payout_vendor_bill_pdf_export", pdf.payload, {
    accepted: true,
    bill: { platform_bill_id: ids.platformBillId, odoo_move_id: 12, payload_sha256: originalHash, state: "posted", odoo_attachment_id: 13, pdf_sha256: "c".repeat(64), pdf_size_bytes: 1000 },
  }));
  assert.throws(() => validatePayoutSelfBillResult("payout_vendor_bill_pdf_export", pdf.payload, {
    accepted: true,
    bill: { platform_bill_id: ids.platformBillId, odoo_move_id: 99, payload_sha256: originalHash, state: "posted", odoo_attachment_id: 13, pdf_sha256: "c".repeat(64), pdf_size_bytes: 1000 },
  }), /identity mismatch/);
  assert.throws(() => validatePayoutSelfBillResult("payout_vendor_bill_pdf_export", pdf.payload, {
    accepted: true,
  }), /must include bill details/);
});
