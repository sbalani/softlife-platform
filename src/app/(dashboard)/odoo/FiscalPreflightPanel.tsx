import type { FiscalPreflightAdminData } from "@/lib/data/odoo-fiscal";
import { OdooSaveForm } from "./OdooSaveForm";
import { prepareFiscalPreflight } from "./actions";

function money(cents: number | undefined, currency = "EUR") {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format((cents ?? 0) / 100);
}

function currentMonth(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(value.get("year"));
  const month = Number(value.get("month"));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${lastDay}` };
}

function statusStyle(status: string) {
  if (status === "ready" || status === "eligible") return "bg-sage/15 text-sage";
  if (status === "excluded") return "bg-taupe/10 text-taupe";
  return "bg-danger/10 text-danger";
}

export function FiscalPreflightPanel({ data, timeZone }: { data: FiscalPreflightAdminData; timeZone: string }) {
  const defaults = currentMonth("Europe/Madrid");
  const latest = data.runs[0] ?? null;
  const summary = latest?.summary;
  return (
    <section className="mb-8 rounded-2xl border border-line bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-cocoa">Fiscal invoicing preflight</h2>
          <p className="mt-1 max-w-3xl text-xs text-taupe">Freeze and inspect completed vending sales before Odoo invoice work is enabled. This screen cannot create, release, or post an invoice.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${data.available ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>{data.available ? "Read-only contract ready" : "Migration pending"}</span>
      </div>

      {!data.available || !data.settings ? <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">Apply the fiscal preflight migration before running this control.</p> : <div className="space-y-5">
        <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-xl bg-cream p-3"><span className="block uppercase text-taupe">Journal</span><strong className="text-cocoa">{data.settings.journal_code}</strong></div>
          <div className="rounded-xl bg-cream p-3"><span className="block uppercase text-taupe">Final consumer</span><strong className="text-cocoa">Odoo {data.settings.customer_odoo_id}</strong></div>
          <div className="rounded-xl bg-cream p-3"><span className="block uppercase text-taupe">VAT</span><strong className="text-cocoa">{data.settings.vat_rate}%</strong></div>
          <div className="rounded-xl bg-cream p-3"><span className="block uppercase text-taupe">Income account</span><strong className="text-cocoa">{data.settings.income_account_code}</strong></div>
          <div className={`rounded-xl p-3 ${data.settings.tax_treatment_approved ? "bg-sage/10" : "bg-warning/10"}`}><span className={`block uppercase ${data.settings.tax_treatment_approved ? "text-sage" : "text-warning"}`}>Tax approval</span><strong className={data.settings.tax_treatment_approved ? "text-sage" : "text-warning"}>{data.settings.tax_treatment_approved ? "Approved" : "Accountant pending"}</strong></div>
          <div className={`rounded-xl p-3 ${data.settings.posting_enabled ? "bg-danger/10" : "bg-sage/10"}`}><span className={`block uppercase ${data.settings.posting_enabled ? "text-danger" : "text-sage"}`}>Posting</span><strong className={data.settings.posting_enabled ? "text-danger" : "text-sage"}>{data.settings.posting_enabled ? "Unexpectedly enabled" : "Disabled"}</strong></div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]">
          <OdooSaveForm action={prepareFiscalPreflight} className="rounded-xl border border-line p-4">
            <h3 className="text-sm font-bold text-cocoa">Freeze a date range</h3>
            <p className="mt-1 text-[11px] text-taupe">Madrid-local days are converted to an exact half-open UTC period, including daylight-saving changes.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-xs text-taupe"><span className="mb-1 block">From</span><input type="date" name="date_from" required defaultValue={defaults.from} className="w-full rounded-lg border border-line px-3 py-2 text-cocoa" /></label>
              <label className="text-xs text-taupe"><span className="mb-1 block">Through</span><input type="date" name="date_to" required defaultValue={defaults.to} className="w-full rounded-lg border border-line px-3 py-2 text-cocoa" /></label>
              <button className="rounded-lg bg-cocoa px-4 py-2 text-xs font-bold text-white">Run read-only preflight</button>
            </div>
          </OdooSaveForm>
          <div className="rounded-xl border border-line p-4 text-xs">
            <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-cocoa">Odoo configuration report</h3><span className={`rounded-full px-2 py-1 font-bold ${data.configuration?.accepted ? "bg-sage/15 text-sage" : "bg-danger/10 text-danger"}`}>{data.configuration?.accepted ? "Accepted" : "Missing or blocked"}</span></div>
            {data.configuration ? <><p className="mt-2 text-taupe">Checked {new Date(data.configuration.checked_at).toLocaleString("en-GB", { timeZone })}</p><p className="mt-1 break-all text-[10px] text-taupe">SHA-256 {data.configuration.payload_sha256}</p>{data.configuration.findings.map((finding) => <p key={finding.code} className={`mt-2 ${finding.severity === "blocker" ? "text-danger" : "text-warning"}`}>{finding.message}</p>)}</> : <p className="mt-2 text-warning">The external Odoo connector must submit its journal, company, customer, tax, and product checks.</p>}
          </div>
        </div>

        {latest && summary && <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-bold text-cocoa">Latest frozen run</h3><p className="text-[11px] text-taupe">{new Date(latest.period_from).toLocaleString("en-GB", { timeZone })} until before {new Date(latest.period_to).toLocaleString("en-GB", { timeZone })} · created {new Date(latest.created_at).toLocaleString("en-GB", { timeZone })}</p></div>
            <div className="flex gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyle(latest.status)}`}>{latest.status}</span><a href={`/odoo/fiscal-preflight/export?run=${latest.id}`} className="rounded-full border border-cocoa px-3 py-1 text-xs font-bold text-cocoa">Export CSV</a></div>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">Eligible</span><strong className="text-lg text-cocoa">{summary.eligible_invoices}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">Blocked</span><strong className="text-lg text-danger">{summary.blocked_orders}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">Excluded</span><strong className="text-lg text-cocoa">{summary.excluded_orders}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">Gross</span><strong className="text-lg text-cocoa">{money(summary.gross_cents, latest.currency)}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">VAT base</span><strong className="text-lg text-cocoa">{money(summary.tax_base_cents, latest.currency)}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">VAT</span><strong className="text-lg text-cocoa">{money(summary.vat_cents, latest.currency)}</strong></div>
          </div>
          {latest.global_findings.length > 0 && <div className="rounded-xl border border-line p-3">{latest.global_findings.map((finding) => <p key={`${finding.severity}:${finding.code}`} className={`text-xs ${finding.severity === "blocker" ? "text-danger" : finding.severity === "warning" ? "text-warning" : "text-taupe"}`}>{finding.message}</p>)}</div>}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="min-w-full text-left text-xs"><thead className="bg-sand uppercase text-taupe"><tr><th className="px-3 py-2">Sale</th><th>Product</th><th>Status</th><th>Gross</th><th>VAT</th><th>Findings</th></tr></thead><tbody className="divide-y divide-line">{data.latestItems.map((item) => <tr key={item.order_id}><td className="px-3 py-2 text-cocoa"><strong>{item.order_code}</strong><span className="block text-[10px] text-taupe">{item.operation_local_date ?? "No date"} · {item.payment_reference ?? item.order_id.slice(0, 8)}</span></td><td className="pr-3 text-cocoa">{item.description ?? "Unresolved"}<span className="block text-[10px] text-taupe">{item.odoo_product_id ? `Odoo ${item.odoo_product_id}` : "No Odoo product"}</span></td><td className="pr-3"><span className={`rounded-full px-2 py-1 font-bold ${statusStyle(item.status)}`}>{item.status}</span></td><td className="pr-3 text-cocoa">{item.gross_cents == null ? "-" : money(item.gross_cents, latest.currency)}</td><td className="pr-3 text-cocoa">{item.vat_cents == null ? "-" : money(item.vat_cents, latest.currency)}</td><td className="max-w-sm py-2 pr-3 text-[10px] text-taupe">{item.findings.map((finding) => finding.message).join(" ") || "No sale-level findings."}</td></tr>)}</tbody></table>
            {!data.latestItems.length && <p className="p-4 text-sm text-taupe">This run contains no sales in the selected period.</p>}
            {summary.selected_orders > data.latestItems.length && <p className="p-3 text-[10px] text-warning">Showing the first {data.latestItems.length} rows. The CSV includes every frozen row.</p>}
          </div>
        </div>}
      </div>}
    </section>
  );
}
