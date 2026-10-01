import type { FiscalPreflightAdminData } from "@/lib/data/odoo-fiscal";
import type { FiscalInvoiceAdminData, FiscalInvoiceQueuePreview } from "@/lib/data/odoo-fiscal-invoices";
import { fiscalCalendarMonth, isFiscalCalendarMonth } from "@/lib/odoo-fiscal-invoices";
import { DraftInvoiceSelectionControls } from "./DraftInvoiceSelectionControls";
import { OdooSaveForm } from "./OdooSaveForm";
import { OdooAccordion } from "./OdooAccordion";
import { prepareFiscalPreflight, requestFiscalInvoiceConfirmation, requestFiscalInvoiceDrafts, retryFiscalInvoiceDrafts } from "./actions";

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
  if (["ready", "eligible", "draft", "draft_ready", "completed", "posted"].includes(status)) return "bg-sage/15 text-sage";
  if (["excluded", "draft_pending", "confirmation_pending"].includes(status)) return "bg-taupe/10 text-taupe";
  return "bg-danger/10 text-danger";
}

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function sourceText(value: unknown) {
  if (value == null || value === "") return "-";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function FiscalPreflightPanel({ data, invoices, queuePreview, timeZone, calendarMonth }: {
  data: FiscalPreflightAdminData;
  invoices: FiscalInvoiceAdminData;
  queuePreview: FiscalInvoiceQueuePreview | null;
  timeZone: string;
  calendarMonth?: string;
}) {
  const defaults = currentMonth("Europe/Madrid");
  const selected = data.selectedRun;
  const summary = selected?.summary;
  const month = isFiscalCalendarMonth(calendarMonth) ? calendarMonth : defaults.from.slice(0, 7);
  const calendar = fiscalCalendarMonth(month, invoices.batches);
  return (
    <OdooAccordion title="Fiscal invoicing" description="Freeze completed vending sales, create one durable Odoo customer-invoice draft per eligible sale, then explicitly confirm selected drafts." badge={<span className={`rounded-full px-3 py-1 text-xs font-bold ${data.available && invoices.available ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>{data.available && invoices.available ? "Execution contract ready" : "Migration pending"}</span>}>
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
            <input type="hidden" name="fiscal_month" value={month} />
            <h3 className="text-sm font-bold text-cocoa">Freeze a date range</h3>
            <p className="mt-1 text-[11px] text-taupe">Madrid-local days are converted to an exact half-open UTC period, including daylight-saving changes.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="text-xs text-taupe"><span className="mb-1 block">From</span><input type="date" name="date_from" required defaultValue={defaults.from} className="w-full rounded-lg border border-line px-3 py-2 text-cocoa" /></label>
              <label className="text-xs text-taupe"><span className="mb-1 block">Through</span><input type="date" name="date_to" required defaultValue={defaults.to} className="w-full rounded-lg border border-line px-3 py-2 text-cocoa" /></label>
              <button className="rounded-lg bg-cocoa px-4 py-2 text-xs font-bold text-white">Freeze preflight</button>
            </div>
          </OdooSaveForm>
          <div className="rounded-xl border border-line p-4 text-xs">
            <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-cocoa">Odoo configuration report</h3><span className={`rounded-full px-2 py-1 font-bold ${data.configuration?.accepted ? "bg-sage/15 text-sage" : "bg-danger/10 text-danger"}`}>{data.configuration?.accepted ? "Accepted" : "Missing or blocked"}</span></div>
            {data.configuration ? <><p className="mt-2 text-taupe">Checked {new Date(data.configuration.checked_at).toLocaleString("en-GB", { timeZone })}</p><p className="mt-1 break-all text-[10px] text-taupe">SHA-256 {data.configuration.payload_sha256}</p>{data.configuration.findings.map((finding) => <p key={finding.code} className={`mt-2 ${finding.severity === "blocker" ? "text-danger" : "text-warning"}`}>{finding.message}</p>)}</> : <p className="mt-2 text-warning">The external Odoo connector must submit its journal, company, customer, tax, and product checks.</p>}
          </div>
        </div>

        {data.runs.length > 0 && <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-cream/50 p-3">
          <input type="hidden" name="fiscal_month" value={month} />
          <label className="min-w-64 flex-1 text-xs text-taupe"><span className="mb-1 block font-semibold text-cocoa">Review a frozen run</span><select name="fiscal_run" defaultValue={selected?.id} className="w-full rounded-lg border border-line bg-white px-3 py-2 text-cocoa">{data.runs.map((run) => <option key={run.id} value={run.id}>{run.id.slice(0, 8)} · {new Date(run.period_from).toLocaleDateString("en-GB", { timeZone })}–{new Date(Date.parse(run.period_to) - 1).toLocaleDateString("en-GB", { timeZone })} · {run.status} · {run.summary.eligible_invoices} eligible</option>)}</select></label>
          <button className="rounded-lg border border-cocoa px-4 py-2 text-xs font-bold text-cocoa">View selected run</button>
        </form>}
        {data.selectionError && <p className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">{data.selectionError} Choose a run above; nothing is selected for execution.</p>}

        {selected && summary && <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-bold text-cocoa">Selected frozen run <span className="font-mono text-terracotta">{selected.id.slice(0, 8)}</span></h3><p className="text-[11px] text-taupe">{new Date(selected.period_from).toLocaleString("en-GB", { timeZone })} until before {new Date(selected.period_to).toLocaleString("en-GB", { timeZone })} · created {new Date(selected.created_at).toLocaleString("en-GB", { timeZone })}</p></div>
            <div className="flex gap-2"><span className={`rounded-full px-3 py-1 text-xs font-bold ${statusStyle(selected.status)}`}>{selected.status}</span><a href={`/odoo/fiscal-preflight/export?run=${selected.id}`} className="rounded-full border border-cocoa px-3 py-1 text-xs font-bold text-cocoa">Export CSV</a></div>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">Eligible</span><strong className="text-lg text-cocoa">{summary.eligible_invoices}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">Blocked</span><strong className="text-lg text-danger">{summary.blocked_orders}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">Excluded</span><strong className="text-lg text-cocoa">{summary.excluded_orders}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">Gross</span><strong className="text-lg text-cocoa">{money(summary.gross_cents, selected.currency)}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">VAT base</span><strong className="text-lg text-cocoa">{money(summary.tax_base_cents, selected.currency)}</strong></div>
            <div className="rounded-xl bg-cream p-3"><span className="block text-taupe">VAT</span><strong className="text-lg text-cocoa">{money(summary.vat_cents, selected.currency)}</strong></div>
          </div>
          {selected.global_findings.length > 0 && <div className="rounded-xl border border-line p-3">{selected.global_findings.map((finding) => <p key={`${finding.severity}:${finding.code}`} className={`text-xs ${finding.severity === "blocker" ? "text-danger" : finding.severity === "warning" ? "text-warning" : "text-taupe"}`}>{finding.message}</p>)}</div>}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="min-w-full text-left text-xs"><thead className="bg-sand uppercase text-taupe"><tr><th className="px-3 py-2">Sale</th><th>Product</th><th>Status</th><th>Gross</th><th>VAT</th><th>Findings</th></tr></thead><tbody className="divide-y divide-line">{data.selectedItems.map((item) => <tr key={item.order_id}><td className="px-3 py-2 text-cocoa"><strong>{item.order_code}</strong><span className="block text-[10px] text-taupe">{item.operation_local_date ?? "No date"} · {item.payment_reference ?? item.order_id.slice(0, 8)}</span></td><td className="pr-3 text-cocoa">{item.description ?? "Unresolved"}<span className="block text-[10px] text-taupe">{item.odoo_product_id ? `Odoo ${item.odoo_product_id}` : "No Odoo product"}</span></td><td className="pr-3"><span className={`rounded-full px-2 py-1 font-bold ${statusStyle(item.status)}`}>{item.status}</span></td><td className="pr-3 text-cocoa">{item.gross_cents == null ? "-" : money(item.gross_cents, selected.currency)}</td><td className="pr-3 text-cocoa">{item.vat_cents == null ? "-" : money(item.vat_cents, selected.currency)}</td><td className="max-w-sm py-2 pr-3 text-[10px] text-taupe"><p>{item.findings.map((finding) => finding.message).join(" ") || "No sale-level findings."}</p><details className="mt-1"><summary className="cursor-pointer font-semibold text-terracotta">Source details</summary><dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"><dt>Payment</dt><dd>{sourceText(item.source_snapshot.pay_type_raw)}</dd><dt>Raw price</dt><dd>{sourceText(item.source_snapshot.price)}</dd><dt>Units</dt><dd>{sourceText(item.source_snapshot.nums)}</dd><dt>State</dt><dd>{sourceText(item.source_snapshot.order_state)} / {sourceText(item.source_snapshot.status_code)}</dd><dt>Machine</dt><dd>{sourceText(item.source_snapshot.machine_id)}</dd><dt>IMEI</dt><dd>{sourceText(item.source_snapshot.device_imei)}</dd><dt>Refund</dt><dd>{sourceText(item.source_snapshot.refund_status)}</dd><dt>Products</dt><dd className="break-all">{sourceText(item.source_snapshot.products)}</dd></dl></details></td></tr>)}</tbody></table>
            {!data.selectedItems.length && <p className="p-4 text-sm text-taupe">This run contains no sales in the selected period.</p>}
            {summary.selected_orders > data.selectedItems.length && <p className="p-3 text-[10px] text-warning">Showing the first {data.selectedItems.length} rows. The CSV includes every frozen row.</p>}
          </div>
          {invoices.available && queuePreview && <div className={`rounded-xl border p-4 ${queuePreview.queueable ? "border-terracotta/30 bg-terracotta/5" : "border-warning/30 bg-warning/5"}`}>
            <h4 className="text-sm font-bold text-cocoa">Execution choice for run {selected.id.slice(0, 8)}</h4>
            <p className="mt-1 text-xs text-cocoa"><strong>Proceed:</strong> create {queuePreview.invoiceCount} Odoo drafts and skip {queuePreview.skippedBlocked} blocked, {queuePreview.skippedExcluded} excluded, and {queuePreview.skippedRefundReview} refund-review sale{queuePreview.skippedRefundReview === 1 ? "" : "s"}.</p>
            {(queuePreview.skippedBlocked + queuePreview.skippedExcluded + queuePreview.skippedRefundReview) > 0 && <p className="mt-2 text-xs text-warning">Skipped rows will not belong to this invoice batch and cannot later be added through another overlapping period batch. If they must be invoiced, stop now, correct them, and freeze a replacement run before queueing anything.</p>}
            {queuePreview.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-warning">Warning: {warning}</p>)}
            {queuePreview.blockers.map((blocker) => <p key={blocker} className="mt-2 text-xs text-danger">Cannot queue: {blocker}</p>)}
            <details className="mt-3 text-[11px] text-taupe"><summary className="cursor-pointer font-semibold text-cocoa">Controls that remain non-bypassable</summary><p className="mt-1">Accepted configuration identity and hash, current tax approval, journal/customer/tax match, compatible Odoo capabilities, the 500-invoice connector limit, unique source orders, no overlapping invoice batch, and no concurrent draft request.</p></details>
            {queuePreview.queueable && <OdooSaveForm action={requestFiscalInvoiceDrafts} className="mt-4 border-t border-terracotta/20 pt-4">
              <input type="hidden" name="preflight_run_id" value={selected.id} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex max-w-3xl items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="draft_acknowledgement" value="create_odoo_invoice_drafts" className="mt-0.5" /><span>I reviewed immutable run {selected.id.slice(0, 8)}. Queue its {queuePreview.invoiceCount} invoiceable sales and deliberately skip {queuePreview.skippedBlocked} blocked, {queuePreview.skippedExcluded} excluded, and {queuePreview.skippedRefundReview} refund-review sales.</span></label>
                <button className="rounded-lg bg-terracotta px-4 py-2 text-xs font-bold text-white">Queue selected run</button>
              </div>
            </OdooSaveForm>}
          </div>}
        </div>}

        {invoices.available && <div className="space-y-4 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-bold text-cocoa">Invoice execution</h3><p className="text-[11px] text-taupe">Reserved source orders remain attached to their batch on connector failure. Posting uses a separate explicit Odoo opt-in; the platform posting lock remains unchanged.</p></div>
            <span className="rounded-full bg-sage/15 px-3 py-1 text-xs font-bold text-sage">{invoices.batches.length} batches</span>
          </div>

          <div className="rounded-xl border border-line p-3">
            <div className="mb-3 flex items-center justify-between"><a href={`/odoo?fiscal_month=${shiftMonth(month, -1)}${selected ? `&fiscal_run=${selected.id}` : ""}`} className="rounded border border-line px-2 py-1 text-xs font-bold text-cocoa">Previous</a><strong className="text-sm text-cocoa">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</strong><a href={`/odoo?fiscal_month=${shiftMonth(month, 1)}${selected ? `&fiscal_run=${selected.id}` : ""}`} className="rounded border border-line px-2 py-1 text-xs font-bold text-cocoa">Next</a></div>
            <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-line text-center text-[10px]"><>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="bg-sand px-1 py-1.5 font-bold uppercase text-taupe">{day}</div>)}</>{calendar.cells.map((cell, index) => <div key={cell?.date ?? `blank-${index}`} className="min-h-16 bg-white p-1 text-left"><span className="text-taupe">{cell?.date.slice(-2)}</span>{cell?.spans.map((span) => <div key={span.id} title={`${span.local_date_from} through ${span.local_date_to} · ${span.status}`} className={`mt-1 truncate rounded px-1 py-0.5 font-semibold ${statusStyle(span.status)}`}>{span.local_date_from === cell.date ? `${span.local_date_from} → ${span.local_date_to}` : span.status}</div>)}</div>)}</div>
            {calendar.clippedSpans.length > 0 && <p className="mt-2 text-[10px] text-taupe">Visible processed ranges: {calendar.clippedSpans.map((span) => `${span.visible_from} through ${span.visible_to} (${span.status})`).join(" · ")}</p>}
          </div>

          {invoices.batches.map((batch) => {
            const documents = invoices.documents.filter((document) => document.batch_id === batch.id);
            const drafts = documents.filter((document) => document.status === "draft");
            const totals = documents.reduce((sum, document) => sum + document.gross_cents, 0);
            return <OdooSaveForm key={batch.id} action={batch.status === "failed" ? retryFiscalInvoiceDrafts : requestFiscalInvoiceConfirmation} className="overflow-hidden rounded-xl border border-line">
              <input type="hidden" name="batch_id" value={batch.id} />
              <details open={drafts.length > 0 || batch.status === "failed" || batch.status === "confirmation_failed"} className="group/batch">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 bg-cream px-3 py-2 text-xs marker:content-none"><span className="text-cocoa"><strong>{batch.local_date_from} through {batch.local_date_to}</strong> · {documents.length} invoices · {money(totals, documents[0]?.currency)}</span><span className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 font-bold ${statusStyle(batch.status)}`}>{batch.status}</span><span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-full border border-line font-bold text-cocoa transition-transform group-open/batch:rotate-180">v</span></span></summary>
                <div className="border-t border-line">
                  {Object.keys(batch.execution_decisions).length > 0 && <p className="border-b border-line bg-cream/40 px-3 py-2 text-[10px] text-taupe">Execution decision: queued {batch.execution_decisions.queued_invoiceable ?? documents.length}; skipped {batch.execution_decisions.skipped_blocked ?? 0} blocked, {batch.execution_decisions.skipped_excluded ?? 0} excluded, and {batch.execution_decisions.skipped_refund_review ?? 0} refund-review sales.</p>}
                  {batch.error && <p className="bg-danger/5 px-3 py-2 text-xs text-danger">{batch.error}</p>}
                  {drafts.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sand/30 px-3 py-2"><span className="text-xs font-semibold text-cocoa">{drafts.length} draft invoice{drafts.length === 1 ? "" : "s"} ready to select</span><DraftInvoiceSelectionControls count={drafts.length} /></div>}
                  <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-sand/50 uppercase text-taupe"><tr><th className="px-3 py-2">Post</th><th>Sale / date</th><th>Total</th><th>Status</th><th>Odoo move</th><th>Reference</th></tr></thead><tbody className="divide-y divide-line">{documents.map((document) => <tr key={document.id}><td className="px-3 py-2">{document.status === "draft" ? <input type="checkbox" name="document_id" value={document.id} aria-label={`Select ${document.order_code}`} /> : ""}</td><td className="pr-3 font-semibold text-cocoa">{document.order_code}<span className="block text-[10px] font-normal text-taupe">{document.invoice_date}</span></td><td className="pr-3 text-cocoa">{money(document.gross_cents, document.currency)}<span className="block text-[10px] text-taupe">VAT {money(document.vat_cents, document.currency)}</span></td><td className="pr-3"><span className={`rounded-full px-2 py-1 font-bold ${statusStyle(document.status)}`}>{document.status}</span></td><td className="pr-3 text-cocoa">{document.odoo_move_id ?? "-"}<span className="block text-[10px] text-taupe">{document.odoo_name ?? document.odoo_state ?? "Not created"}</span></td><td className="max-w-48 truncate py-2 pr-3 text-taupe" title={document.reference}>{document.reference}</td></tr>)}</tbody></table></div>
                  {drafts.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-3"><label className="flex items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="confirmation_acknowledgement" value="post_selected_odoo_invoices" className="mt-0.5" /><span>I authorize posting only the selected Odoo draft invoices.</span></label><button className="rounded-lg bg-cocoa px-4 py-2 text-xs font-bold text-white">Confirm selected</button></div>}
                  {batch.status === "failed" && documents.length > 0 && documents.every((document) => document.status === "draft_failed") && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-3"><label className="flex items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="retry_acknowledgement" value="retry_exact_invoice_drafts" className="mt-0.5" /><span>Retry the exact frozen draft payload and platform invoice IDs. No source or accounting values will change.</span></label><button className="rounded-lg bg-terracotta px-4 py-2 text-xs font-bold text-white">Retry Odoo drafts</button></div>}
                </div>
              </details>
            </OdooSaveForm>;
          })}
          {!invoices.batches.length && <p className="rounded-xl bg-cream p-4 text-sm text-taupe">No fiscal invoice batches have been queued.</p>}
        </div>}
      </div>}
    </OdooAccordion>
  );
}
