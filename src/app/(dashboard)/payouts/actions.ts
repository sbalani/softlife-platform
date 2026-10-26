"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { getPayoutReadiness, getTenantBankDetails, getTenantById, tenantPostalAddress } from "@/lib/data/franchisees";
import { getTenantPayoutReport } from "@/lib/data/franchisee-profit";
import { isPayoutMonth, payoutMonthRange } from "@/lib/payouts";
import { FRANCHISEE_CONTRACT_VERSION } from "@/lib/franchisee-onboarding-contract";
import { getCurrentTenantContractAcceptance } from "@/lib/data/franchisee-contract-acceptances";
import { canonicalJson, sha256 } from "@/lib/odoo-sync-contract";
import { buildPayoutSelfBillDraftPayload, spanishPayoutCountryCode } from "@/lib/payout-self-billing";

export type MarkPayoutState = { ok: boolean; message: string } | null;
export type PayoutActionState = { ok: boolean; message: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function markPayoutPaid(_previous: MarkPayoutState, formData: FormData): Promise<MarkPayoutState> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") return { ok: false, message: "Admin access required." };

  const tenantId = String(formData.get("tenant_id") ?? "");
  const month = String(formData.get("month") ?? "");
  const paymentReference = String(formData.get("payment_reference") ?? "").trim();
  if (!UUID.test(tenantId) || !isPayoutMonth(month)) return { ok: false, message: "Invalid payout selection." };
  if (formData.get("confirmed") !== "yes") return { ok: false, message: "Confirm the transfer and agreement check first." };
  if (!paymentReference || paymentReference.length > 200) return { ok: false, message: "Enter the bank transfer reference." };

  try {
    const range = payoutMonthRange(month);
    if (range.month !== month || month >= range.currentMonth) return { ok: false, message: "Only completed payout months can be marked paid." };
    const [report, readiness, tenant, bank, acceptance] = await Promise.all([
      getTenantPayoutReport(tenantId, range.from, range.to),
      getPayoutReadiness(tenantId),
      getTenantById(tenantId),
      getTenantBankDetails(tenantId),
      getCurrentTenantContractAcceptance(tenantId),
    ]);
    if (!report) return { ok: false, message: "Franchisee account not found." };
    if (!readiness.ready) return { ok: false, message: "Complete the franchisee payout details before marking this payment paid." };
    if (!tenant?.company_name || !tenant.tax_id || !bank) return { ok: false, message: "Complete the franchisee payment recipient details first." };

    const totalCents = Math.round(report.rows.reduce((sum, row) => sum + row.payout, 0) * 100);
    if (totalCents <= 0) return { ok: false, message: "A zero payout cannot be marked paid." };

    const service = await createServiceClient();
    const periodMonth = `${month}-01`;
    const sourceSnapshot = {
        version: 1,
        tenantId,
        tenantName: report.tenantName,
        from: range.from,
        to: range.to,
        totalCents,
        rows: report.rows,
        paymentDetails: {
          recipientLegalName: tenant.company_name,
          recipientTaxId: tenant.tax_id,
          recipientAddress: tenantPostalAddress(tenant),
          bankDetails: {
            accountHolderName: bank.account_holder_name,
            iban: bank.iban,
            bicSwift: bank.bic_swift,
            bankName: bank.bank_name,
          },
          paymentReference,
        },
      };
    const { data, error } = await service.rpc("mark_payout_settlement_paid", {
      p_tenant_id: tenantId,
      p_period_month: periodMonth,
      p_paid_by: session.id,
      p_payment_reference: paymentReference,
      p_total_cents: totalCents,
      p_agreement_version: FRANCHISEE_CONTRACT_VERSION,
      p_contract_acceptance_id: acceptance?.id ?? null,
      p_source_snapshot: sourceSnapshot,
    });
    if (error) throw error;
    if ((data as { already_paid?: boolean } | null)?.already_paid) return { ok: true, message: "This payout was already marked paid." };
    revalidatePath("/payouts");
    return { ok: true, message: "Payout marked paid." };
  } catch (error) {
    console.error("[payouts] Could not mark payout paid:", error);
    return { ok: false, message: "The payout could not be updated. Please retry." };
  }
}

export async function createPayoutSelfBill(_previous: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") return { ok: false, message: "Admin access required." };
  const tenantId = String(formData.get("tenant_id") ?? "");
  const month = String(formData.get("month") ?? "");
  if (!UUID.test(tenantId) || !isPayoutMonth(month)) return { ok: false, message: "Invalid payout selection." };
  try {
    const range = payoutMonthRange(month);
    if (range.month !== month || month >= range.currentMonth) return { ok: false, message: "Only completed payout months can be billed." };
    const [report, tenant, acceptance] = await Promise.all([
      getTenantPayoutReport(tenantId, range.from, range.to),
      getTenantById(tenantId),
      getCurrentTenantContractAcceptance(tenantId),
    ]);
    if (!report || !tenant || !acceptance || acceptance.contract_version !== FRANCHISEE_CONTRACT_VERSION) return { ok: false, message: "The current v3 contract must be accepted first." };
    const requiredVendor = [tenant.company_name, tenant.tax_id, tenant.contact_email, tenant.address_line_1, tenant.postal_code, tenant.city, tenant.province, tenant.country];
    if (requiredVendor.some((value) => !value?.trim())) return { ok: false, message: "Complete the franchisee legal, email, and postal details first." };
    const countryCode = spanishPayoutCountryCode(tenant.country);
    if (!countryCode) return { ok: false, message: "Self-billing currently requires a Spanish franchisee address." };
    const grossCents = Math.round(report.rows.reduce((sum, row) => sum + row.payout, 0) * 100);
    if (grossCents <= 0) return { ok: false, message: "A zero payout cannot be billed." };
    const service = await createServiceClient();
    const periodMonth = `${month}-01`;
    const { data: existing, error: existingError } = await service.from("franchisee_payout_settlements")
      .select("id,source_snapshot,calculated_total_cents,payout_self_bills(id,payload,payload_sha256,status)")
      .eq("tenant_id", tenantId).eq("period_month", periodMonth).maybeSingle();
    if (existingError) throw existingError;
    const recalculatedSnapshot = { version: 1, tenantId, tenantName: report.tenantName, from: range.from, to: range.to, totalCents: grossCents, rows: report.rows };
    const sourceSnapshot = existing?.source_snapshot ?? recalculatedSnapshot;
    const sourceSnapshotSha256 = sha256(sourceSnapshot);
    const existingBill = Array.isArray(existing?.payout_self_bills) ? existing.payout_self_bills[0] : existing?.payout_self_bills;
    if (existingBill) {
      if (existing?.calculated_total_cents !== grossCents) return { ok: false, message: "The frozen payout differs from the current calculation." };
      if (existingBill.status === "failed") return retryPayoutSelfBillById(service, session.id, String(existingBill.id));
      return { ok: true, message: "This self-bill is already queued or created." };
    }
    const platformBillId = randomUUID();
    const settlementId = existing?.id ? String(existing.id) : randomUUID();
    const built = buildPayoutSelfBillDraftPayload({
      platformBillId,
      settlementId,
      tenantId,
      periodMonth: month,
      invoiceDate: range.to,
      grossCents,
      contractAcceptanceId: acceptance.id,
      sourceSnapshotSha256,
      vendor: {
        legal_name: tenant.company_name!, tax_id: tenant.tax_id!, email: tenant.contact_email!,
        address_line_1: tenant.address_line_1!, address_line_2: tenant.address_line_2?.trim() || null,
        postal_code: tenant.postal_code!, city: tenant.city!, province: tenant.province!, country_code: countryCode,
      },
    });
    if (built.payloadSha256 !== sha256(canonicalJson(built.payload))) throw new Error("Could not freeze canonical self-bill payload");
    const { error } = await service.rpc("create_payout_self_bill", {
      p_platform_bill_id: platformBillId,
      p_settlement_id: settlementId,
      p_tenant_id: tenantId,
      p_period_month: periodMonth,
      p_requested_by: session.id,
      p_calculated_total_cents: grossCents,
      p_source_snapshot: sourceSnapshot,
      p_source_snapshot_sha256: sourceSnapshotSha256,
      p_contract_acceptance_id: acceptance.id,
      p_payload: built.payload,
      p_payload_sha256: built.payloadSha256,
      p_draft_only: formData.get("draft_only") === "yes",
    });
    if (error) throw error;
    revalidatePath("/payouts");
    return { ok: true, message: "Self-bill creation queued." };
  } catch (error) {
    console.error("[payouts] Could not create self-bill:", error);
    return { ok: false, message: "The self-bill could not be queued. Check the frozen data and retry." };
  }
}

async function retryPayoutSelfBillById(service: Awaited<ReturnType<typeof createServiceClient>>, requestedBy: string, selfBillId: string): Promise<PayoutActionState> {
  const { error } = await service.rpc("retry_payout_self_bill", { p_self_bill_id: selfBillId, p_requested_by: requestedBy });
  if (error) throw error;
  revalidatePath("/payouts");
  return { ok: true, message: "The exact failed request was queued again." };
}

export async function postPayoutSelfBill(_previous: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") return { ok: false, message: "Admin access required." };
  const selfBillId = String(formData.get("self_bill_id") ?? "");
  if (!UUID.test(selfBillId)) return { ok: false, message: "Invalid self-bill." };
  try {
    const { error } = await (await createServiceClient()).rpc("post_payout_self_bill", { p_self_bill_id: selfBillId, p_requested_by: session.id });
    if (error) throw error;
    revalidatePath("/payouts");
    return { ok: true, message: "Self-bill posting queued." };
  } catch (error) {
    console.error("[payouts] Could not post self-bill:", error);
    return { ok: false, message: "The self-bill could not be posted. Retry." };
  }
}

export async function retryPayoutSelfBill(_previous: PayoutActionState, formData: FormData): Promise<PayoutActionState> {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") return { ok: false, message: "Admin access required." };
  const selfBillId = String(formData.get("self_bill_id") ?? "");
  if (!UUID.test(selfBillId)) return { ok: false, message: "Invalid self-bill." };
  try {
    return await retryPayoutSelfBillById(await createServiceClient(), session.id, selfBillId);
  } catch (error) {
    console.error("[payouts] Could not retry self-bill:", error);
    return { ok: false, message: "The exact failed request could not be retried." };
  }
}
