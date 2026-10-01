import Link from "next/link";
import { redirect } from "next/navigation";
import { KpiCard } from "@/components/charts";
import { getSessionProfile } from "@/lib/auth/session";
import { getPayoutReadiness, getTenantSummaries } from "@/lib/data/franchisees";
import { getPayoutReports, getTenantPayoutReport, type PayoutReport } from "@/lib/data/franchisee-profit";
import { getPayoutSettlements } from "@/lib/data/payouts";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { FRANCHISEE_CONTRACT_VERSION } from "@/lib/franchisee-onboarding-contract";
import { payoutMonthRange } from "@/lib/payouts";
import { payoutTaxBreakdown } from "@/lib/payout-report";
import { MarkPayoutPaidForm } from "./MarkPayoutPaidForm";

export const dynamic = "force-dynamic";

type SearchParams = { month?: string };
type MissingField = "company" | "tax" | "bank";

const MISSING_LABELS: Record<MissingField, string> = {
  company: "Company/autonomo name is missing",
  tax: "NIF/CIF is missing",
  bank: "Bank account is missing",
};

export default async function PayoutsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [session, params, tz] = await Promise.all([getSessionProfile(), searchParams, getDisplayTimezone()]);
  if (!session || session.role === "operator") redirect("/dashboard");
  if (session.role === "franchisee" && !session.tenant_id) redirect("/account");

  const range = payoutMonthRange(params.month);
  let reports: PayoutReport[];
  let readiness = new Map<string, MissingField[]>();

  if (session.role === "admin") {
    const [loadedReports, summaries] = await Promise.all([
      getPayoutReports(range.from, range.to, undefined, { includeZero: true }),
      getTenantSummaries(),
    ]);
    reports = loadedReports;
    readiness = new Map(summaries.filter((tenant) => tenant.kind === "franchisee").map((tenant) => {
      const missing: MissingField[] = [];
      if (!tenant.company_name) missing.push("company");
      if (!tenant.tax_id) missing.push("tax");
      if (!tenant.has_bank_details) missing.push("bank");
      return [tenant.id, missing];
    }));
  } else {
    const tenantId = session.tenant_id!;
    const [report, payoutReadiness] = await Promise.all([
      getTenantPayoutReport(tenantId, range.from, range.to),
      getPayoutReadiness(tenantId),
    ]);
    reports = report ? [{ tenantId, tenantName: report.tenantName, rows: report.rows, total: report.rows.reduce((sum, row) => sum + row.payout, 0) }] : [];
    readiness.set(tenantId, [...payoutReadiness.missing]);
  }

  const settlements = await getPayoutSettlements(range.month, reports.map((report) => report.tenantId));
  const settlementByTenant = new Map(settlements.map((settlement) => [settlement.tenant_id, settlement]));
  const rows = reports.map((report) => {
    const payout = payoutTaxBreakdown(report.total);
    const settlement = settlementByTenant.get(report.tenantId);
    const missing = readiness.get(report.tenantId) ?? [];
    const issues = missing.map((field) => MISSING_LABELS[field]);
    if (payout.total === 0) issues.push("No eligible completed sales in this month");
    if (range.month === range.currentMonth) issues.push("Current month is still in progress and cannot be marked paid");
    if (settlement?.paid_total_cents != null && settlement.paid_total_cents !== Math.round(payout.total * 100)) {
      issues.push("Current calculation differs from the paid amount");
    }
    return { report, payout, settlement, missing, issues };
  });
  const total = rows.reduce((sum, row) => sum + row.payout.total, 0);
  const paidRows = rows.filter((row) => row.settlement?.status === "paid");
  const paidTotal = paidRows.reduce((sum, row) => sum + (row.settlement?.paid_total_cents ?? 0), 0) / 100;

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-cocoa">Payouts</h1>
          <p className="mt-1 text-sm text-taupe">Monthly franchisee settlements, payment status, and payment issues.</p>
        </div>
        <form className="flex items-end gap-2 rounded-xl border border-line bg-white p-3">
          <label><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-taupe">Month</span><input type="month" name="month" defaultValue={range.month} max={range.currentMonth} className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa" /></label>
          <button className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">View</button>
        </form>
      </header>

      <div role="alert" className="mb-5 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-cocoa">
        <p className="font-bold">New self-billing agreement acceptance required</p>
        <p className="mt-1 text-xs leading-5 text-taupe">
          Every franchisee must accept the current agreement ({FRANCHISEE_CONTRACT_VERSION}), including authorization for self-billing, before the next payment is released. Tenant-linked acceptance tracking is not yet available, so admins must verify the signed evidence before marking a payout paid.
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Selected month" value={range.label} hint={`${range.from} to ${range.to}`} accent="#d47e54" />
        <KpiCard label="Calculated payout" value={`€${total.toFixed(2)}`} hint={`${rows.length} franchisee${rows.length === 1 ? "" : "s"}`} accent="#6fa98c" />
        <KpiCard label="Paid" value={`€${paidTotal.toFixed(2)}`} hint={`${paidRows.length} marked paid`} accent="#6fa98c" />
        <KpiCard label="Pending" value={`${rows.length - paidRows.length}`} hint="Not yet marked paid" accent="#d47e54" />
      </div>

      <section className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr><th className="px-5 py-3">Month</th><th className="px-5 py-3">Franchisee</th><th className="px-5 py-3 text-right">Payout</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Notices / issues</th><th className="px-5 py-3 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ report, payout, settlement, missing, issues }) => {
              const paid = settlement?.status === "paid";
              const exportUrl = paid && settlement
                ? `/payouts/${settlement.id}/pdf`
                : `/analytics/payout/export?${new URLSearchParams({ tenantId: report.tenantId, dateFrom: range.from, dateTo: range.to })}`;
              return (
                <tr key={report.tenantId} className="align-top hover:bg-cream/30">
                  <td className="px-5 py-4 font-semibold text-cocoa">{range.label}</td>
                  <td className="px-5 py-4"><span className="font-bold text-cocoa">{report.tenantName}</span><span className="block text-xs text-taupe">{report.rows.length} machine assignment{report.rows.length === 1 ? "" : "s"}</span></td>
                  <td className="px-5 py-4 text-right"><span className="font-bold text-cocoa">€{payout.total.toFixed(2)}</span><span className="block text-xs text-taupe">Base €{payout.base.toFixed(2)} · IVA €{payout.iva.toFixed(2)}</span>{paid && settlement.paid_total_cents != null && <span className="block text-xs text-sage">Paid €{(settlement.paid_total_cents / 100).toFixed(2)}</span>}</td>
                  <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${paid ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>{paid ? "Paid" : "Pending"}</span>{settlement?.paid_at && <span className="mt-2 block text-xs text-taupe">{formatDateTime(settlement.paid_at, tz)}</span>}{settlement?.payment_reference && <span className="mt-1 block text-xs text-taupe">Ref: {settlement.payment_reference}</span>}</td>
                  <td className="px-5 py-4 text-xs"><p className="font-semibold text-warning">Agreement acceptance must be verified</p>{issues.map((issue) => <p key={issue} className={issue.includes("differs") ? "font-semibold text-danger" : "mt-1 text-taupe"}>{issue}</p>)}</td>
                  <td className="px-5 py-4"><div className="flex justify-end gap-2">{payout.total > 0 && <Link href={exportUrl} className="rounded-lg border border-terracotta px-3 py-2 text-xs font-bold text-terracotta">PDF</Link>}{session.role === "admin" && range.month < range.currentMonth && !paid && missing.length === 0 && payout.total > 0 && <MarkPayoutPaidForm tenantId={report.tenantId} month={range.month} />}</div></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-taupe">No franchisee payout accounts are available.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
