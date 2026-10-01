"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { getPayoutReadiness } from "@/lib/data/franchisees";
import { getTenantPayoutReport } from "@/lib/data/franchisee-profit";
import { isPayoutMonth, payoutMonthRange } from "@/lib/payouts";
import { FRANCHISEE_CONTRACT_VERSION } from "@/lib/franchisee-onboarding-contract";

export type MarkPayoutState = { ok: boolean; message: string } | null;

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
    const [report, readiness] = await Promise.all([
      getTenantPayoutReport(tenantId, range.from, range.to),
      getPayoutReadiness(tenantId),
    ]);
    if (!report) return { ok: false, message: "Franchisee account not found." };
    if (!readiness.ready) return { ok: false, message: "Complete the franchisee payout details before marking this payment paid." };

    const totalCents = Math.round(report.rows.reduce((sum, row) => sum + row.payout, 0) * 100);
    if (totalCents <= 0) return { ok: false, message: "A zero payout cannot be marked paid." };

    const service = await createServiceClient();
    const periodMonth = `${month}-01`;
    const { data: existing, error: lookupError } = await service
      .from("franchisee_payout_settlements")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("period_month", periodMonth)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.status === "paid") return { ok: true, message: "This payout was already marked paid." };

    const paidAt = new Date().toISOString();
    const { error } = await service.from("franchisee_payout_settlements").insert({
      tenant_id: tenantId,
      period_month: periodMonth,
      status: "paid",
      calculated_total_cents: totalCents,
      paid_total_cents: totalCents,
      paid_at: paidAt,
      paid_by: session.id,
      payment_reference: paymentReference,
      agreement_version: FRANCHISEE_CONTRACT_VERSION,
      source_snapshot: {
        version: 1,
        tenantId,
        tenantName: report.tenantName,
        from: range.from,
        to: range.to,
        totalCents,
        rows: report.rows,
      },
    });
    if (error?.code === "23505") return { ok: true, message: "This payout was already marked paid." };
    if (error) throw error;
    revalidatePath("/payouts");
    return { ok: true, message: "Payout marked paid." };
  } catch (error) {
    console.error("[payouts] Could not mark payout paid:", error);
    return { ok: false, message: "The payout could not be updated. Please retry." };
  }
}
