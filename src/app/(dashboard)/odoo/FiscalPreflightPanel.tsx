import type { FiscalPreflightAdminData } from "@/lib/data/odoo-fiscal";
import type { FiscalInvoiceAdminData, FiscalInvoiceQueuePreview } from "@/lib/data/odoo-fiscal-invoices";
import { isFiscalCalendarMonth } from "@/lib/odoo-fiscal-invoices";
import { OdooSaveForm } from "./OdooSaveForm";
import { OdooAccordion } from "./OdooAccordion";
import { cancelFailedFiscalInvoiceJob, prepareFiscalPreflight, requestFiscalInvoiceConfirmation, requestFiscalInvoiceDrafts, retryFiscalInvoiceDrafts } from "./actions";

function money(cents: number | undefined, currency = "EUR") {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format((cents ?? 0) / 100);
}

function monthDateRange(month: string) {
  const [year, value] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${lastDay}` };
}

function statusStyle(status: string) {
  if (["ready", "eligible", "draft", "draft_ready", "completed", "posted"].includes(status)) return "bg-sage/15 text-sage";
  if (["excluded", "queued", "draft_pending", "confirmation_pending"].includes(status)) return "bg-taupe/10 text-taupe";
  return "bg-danger/10 text-danger";
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
  const selected = data.selectedRun;
  const summary = selected?.summary;
  const month = isFiscalCalendarMonth(calendarMonth) ? calendarMonth : new Date().toISOString().slice(0, 7);
  const defaults = monthDateRange(month);
  return (
    <OdooAccordion title="Fiscal invoicing" description="Freeze completed sales. Legacy periods create one draft per sale; post-cutover months create requested invoices plus one consolidated remainder invoice." badge={<span className={`rounded-full px-3 py-1 text-xs font-bold ${data.available && invoices.available ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>{data.available && invoices.available ? "Execution contract ready" : "Migration pending"}</span>}>
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
          <OdooSaveForm key={month} action={prepareFiscalPreflight} className="rounded-xl border border-line p-4">
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
          <details className="rounded-xl border border-line" open={summary.blocked_orders > 0}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-cocoa">Frozen sales ({summary.selected_orders})</summary>
            <div className="overflow-x-auto border-t border-line"><table className="min-w-full text-left text-xs"><thead className="bg-sand uppercase text-taupe"><tr><th className="px-3 py-2">Sale</th><th>Product</th><th>Status</th><th>Gross</th><th>VAT</th><th>Findings</th></tr></thead><tbody className="divide-y divide-line">{data.selectedItems.map((item) => <tr key={item.order_id}><td className="px-3 py-2 text-cocoa"><strong>{item.order_code}</strong><span className="block text-[10px] text-taupe">{item.operation_local_date ?? "No date"} · {item.payment_reference ?? item.order_id.slice(0, 8)}</span></td><td className="pr-3 text-cocoa">{item.description ?? "Unresolved"}<span className="block text-[10px] text-taupe">{item.odoo_product_id ? `Odoo ${item.odoo_product_id}` : "No Odoo product"}</span></td><td className="pr-3"><span className={`rounded-full px-2 py-1 font-bold ${statusStyle(item.status)}`}>{item.status}</span></td><td className="pr-3 text-cocoa">{item.gross_cents == null ? "-" : money(item.gross_cents, selected.currency)}</td><td className="pr-3 text-cocoa">{item.vat_cents == null ? "-" : money(item.vat_cents, selected.currency)}</td><td className="max-w-sm py-2 pr-3 text-[10px] text-taupe"><p>{item.findings.map((finding) => finding.message).join(" ") || "No sale-level findings."}</p><details className="mt-1"><summary className="cursor-pointer font-semibold text-terracotta">Source details</summary><dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"><dt>Payment</dt><dd>{sourceText(item.source_snapshot.pay_type_raw)}</dd><dt>Raw price</dt><dd>{sourceText(item.source_snapshot.price)}</dd><dt>Units</dt><dd>{sourceText(item.source_snapshot.nums)}</dd><dt>State</dt><dd>{sourceText(item.source_snapshot.order_state)} / {sourceText(item.source_snapshot.status_code)}</dd><dt>Machine</dt><dd>{sourceText(item.source_snapshot.machine_id)}</dd><dt>IMEI</dt><dd>{sourceText(item.source_snapshot.device_imei)}</dd><dt>Refund</dt><dd>{sourceText(item.source_snapshot.refund_status)}</dd><dt>Products</dt><dd className="break-all">{sourceText(item.source_snapshot.products)}</dd></dl></details></td></tr>)}</tbody></table>
              {!data.selectedItems.length && <p className="p-4 text-sm text-taupe">This run contains no sales in the selected period.</p>}
              {summary.selected_orders > data.selectedItems.length && <p className="p-3 text-[10px] text-warning">Showing the first {data.selectedItems.length} rows. The CSV includes every frozen row.</p>}
            </div>
          </details>
          {invoices.available && queuePreview && <div className={`rounded-xl border p-4 ${queuePreview.queueable ? "border-terracotta/30 bg-terracotta/5" : "border-warning/30 bg-warning/5"}`}>
            <h4 className="text-sm font-bold text-cocoa">Execution choice for run {selected.id.slice(0, 8)}</h4>
            <p className="mt-1 text-xs text-cocoa"><strong>Proceed:</strong> create {queuePreview.invoiceCount} Odoo drafts in {queuePreview.internalBatchCount} sequential internal batch{queuePreview.internalBatchCount === 1 ? "" : "es"} ({queuePreview.internalBatchSizes.join(" + ")}) and skip {queuePreview.skippedBlocked} blocked, {queuePreview.skippedExcluded} excluded, and {queuePreview.skippedRefundReview} refund-review sale{queuePreview.skippedRefundReview === 1 ? "" : "s"}.</p>
            {(queuePreview.skippedBlocked + queuePreview.skippedExcluded + queuePreview.skippedRefundReview) > 0 && <p className="mt-2 text-xs text-warning">Skipped rows will not belong to this invoice batch and cannot later be added through another overlapping period batch. If they must be invoiced, stop now, correct them, and freeze a replacement run before queueing anything.</p>}
            {queuePreview.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-warning">Warning: {warning}</p>)}
            {queuePreview.blockers.map((blocker) => <p key={blocker} className="mt-2 text-xs text-danger">Cannot queue: {blocker}</p>)}
            <details className="mt-3 text-[11px] text-taupe"><summary className="cursor-pointer font-semibold text-cocoa">Controls that remain non-bypassable</summary><p className="mt-1">Accepted configuration identity and hash, current tax approval, journal/customer/tax match, compatible Odoo capabilities, at most 500 invoices per internal connector request, unique source orders, no overlapping invoice job, and no concurrent draft request.</p></details>
            {queuePreview.queueable && <OdooSaveForm action={requestFiscalInvoiceDrafts} className="mt-4 border-t border-terracotta/20 pt-4">
              <input type="hidden" name="preflight_run_id" value={selected.id} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex max-w-3xl items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="draft_acknowledgement" value="create_odoo_invoice_drafts" className="mt-0.5" /><span>I reviewed immutable run {selected.id.slice(0, 8)}. Create one invoice job for its {queuePreview.invoiceCount} invoiceable sales in {queuePreview.internalBatchCount} sequential internal batch{queuePreview.internalBatchCount === 1 ? "" : "es"}, and deliberately skip {queuePreview.skippedBlocked} blocked, {queuePreview.skippedExcluded} excluded, and {queuePreview.skippedRefundReview} refund-review sales.</span></label>
                <button className="rounded-lg bg-terracotta px-4 py-2 text-xs font-bold text-white">Create invoice job</button>
              </div>
            </OdooSaveForm>}
          </div>}
        </div>}

        {invoices.available && <div className="space-y-4 border-t border-line pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-bold text-cocoa">Invoice execution</h3><p className="text-[11px] text-taupe">Reserved source orders remain attached to their batch on connector failure. Posting uses a separate explicit Odoo opt-in; the platform posting lock remains unchanged.</p></div>
            <span className="rounded-full bg-sage/15 px-3 py-1 text-xs font-bold text-sage">{invoices.jobs.length} jobs</span>
          </div>

          <details className="rounded-xl border border-line" open={invoices.jobs.some((job) => !["completed", "cancelled"].includes(job.status))}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-cocoa">Invoice jobs ({invoices.jobs.length})</summary>
            <div className="space-y-4 border-t border-line p-3">{invoices.jobs.map((job) => {
            const batches = invoices.batches.filter((batch) => batch.job_id === job.id);
            const batchIds = new Set(batches.map((batch) => batch.id));
            const documents = invoices.documents.filter((document) => batchIds.has(document.batch_id));
            const hasCompleteDocumentSet = documents.length === job.document_count;
            const totals = job.gross_cents;
            return <div key={job.id} className="overflow-hidden rounded-xl border border-line">
              <details open={job.draft_count > 0 || job.status === "failed" || job.status === "confirmation_failed"} className="group/batch">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 bg-cream px-3 py-2 text-xs marker:content-none"><span className="text-cocoa"><strong>{job.local_date_from} through {job.local_date_to}</strong> · {job.document_count} invoices · {money(totals, documents[0]?.currency)}</span><span className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 font-bold ${statusStyle(job.status)}`}>{job.status}</span><span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-full border border-line font-bold text-cocoa transition-transform group-open/batch:rotate-180">v</span></span></summary>
                <div className="border-t border-line">
                  {Object.keys(job.execution_decisions).length > 0 && <p className="border-b border-line bg-cream/40 px-3 py-2 text-[10px] text-taupe">Execution decision: queued {job.execution_decisions.queued_invoiceable ?? documents.length}; skipped {job.execution_decisions.skipped_blocked ?? 0} blocked, {job.execution_decisions.skipped_excluded ?? 0} excluded, and {job.execution_decisions.skipped_refund_review ?? 0} refund-review sales.</p>}
                  <div className="grid gap-px border-b border-line bg-line sm:grid-cols-4">{batches.map((batch) => <div key={batch.id} className="bg-white px-3 py-2 text-[10px] text-taupe"><strong className="block text-cocoa">Internal batch {batch.batch_sequence}</strong><span className={statusStyle(batch.status).split(" ").at(-1)}>{batch.status}</span>{batch.error && <span className="mt-1 block text-danger">{batch.error}</span>}</div>)}</div>
                  {job.error && <p className="bg-danger/5 px-3 py-2 text-xs text-danger">{job.error}</p>}
                  <p className="border-b border-line bg-sand/30 px-3 py-2 text-xs font-semibold text-cocoa">{job.posted_count}/{job.document_count} posted · {job.draft_count} drafts ready · {job.completed_internal_batch_count}/{job.internal_batch_count} internal batches complete</p>
                  <div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-sand/50 uppercase text-taupe"><tr><th className="px-3 py-2">Batch</th><th>Sale / date</th><th>Total</th><th>Status</th><th>Odoo move</th><th>Reference</th></tr></thead><tbody className="divide-y divide-line">{documents.map((document) => <tr key={document.id}><td className="px-3 py-2">{batches.find((batch) => batch.id === document.batch_id)?.batch_sequence ?? "-"}</td><td className="pr-3 font-semibold text-cocoa">{document.order_code}<span className="block text-[10px] font-normal text-taupe">{document.invoice_date}</span></td><td className="pr-3 text-cocoa">{money(document.gross_cents, document.currency)}<span className="block text-[10px] text-taupe">VAT {money(document.vat_cents, document.currency)}</span></td><td className="pr-3"><span className={`rounded-full px-2 py-1 font-bold ${statusStyle(document.status)}`}>{document.status}</span></td><td className="pr-3 text-cocoa">{document.odoo_move_id ?? "-"}<span className="block text-[10px] text-taupe">{document.odoo_name ?? document.odoo_state ?? "Not created"}</span></td><td className="max-w-48 truncate py-2 pr-3 text-taupe" title={document.reference}>{document.reference}</td></tr>)}</tbody></table></div>
                  {!hasCompleteDocumentSet && <p className="border-t border-line bg-danger/5 px-3 py-2 text-xs text-danger">Showing {documents.length} of {job.document_count} invoice documents. Posting is disabled until the complete review set can be loaded.</p>}
                  {job.status === "draft_ready" && job.draft_count > 0 && hasCompleteDocumentSet && <OdooSaveForm action={requestFiscalInvoiceConfirmation} className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-3"><input type="hidden" name="job_id" value={job.id} /><label className="flex items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="confirmation_acknowledgement" value="post_selected_odoo_invoices" className="mt-0.5" /><span>I authorize posting all {job.draft_count} reviewed Odoo draft invoices in sequential internal batches.</span></label><button className="rounded-lg bg-cocoa px-4 py-2 text-xs font-bold text-white">Post invoice job</button></OdooSaveForm>}
                  {job.status === "confirmation_failed" && job.draft_count > 0 && hasCompleteDocumentSet && <OdooSaveForm action={requestFiscalInvoiceConfirmation} className="flex flex-wrap items-center justify-between gap-3 border-t border-line p-3"><input type="hidden" name="job_id" value={job.id} /><label className="flex items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="confirmation_acknowledgement" value="post_selected_odoo_invoices" className="mt-0.5" /><span>Retry posting the exact remaining draft invoices. Already posted invoices will not be included.</span></label><button className="rounded-lg bg-cocoa px-4 py-2 text-xs font-bold text-white">Retry posting</button></OdooSaveForm>}
                  {job.status === "failed" && <div className="grid gap-px border-t border-line bg-line lg:grid-cols-2"><OdooSaveForm action={retryFiscalInvoiceDrafts} className="flex flex-wrap items-center justify-between gap-3 bg-white p-3"><input type="hidden" name="job_id" value={job.id} /><label className="flex items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="retry_acknowledgement" value="retry_exact_invoice_drafts" className="mt-0.5" /><span>Retry the failed internal batch with its exact frozen payload.</span></label><button className="rounded-lg bg-terracotta px-4 py-2 text-xs font-bold text-white">Retry Odoo drafts</button></OdooSaveForm><OdooSaveForm action={cancelFailedFiscalInvoiceJob} className="flex flex-wrap items-center justify-between gap-3 bg-white p-3"><input type="hidden" name="job_id" value={job.id} /><label className="flex items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="cancel_acknowledgement" value="cancel_empty_failed_invoice_job" className="mt-0.5" /><span>Cancel only if this failed job created no Odoo invoice identities.</span></label><button className="rounded-lg border border-danger px-4 py-2 text-xs font-bold text-danger">Cancel failed job</button></OdooSaveForm></div>}
                </div>
              </details>
            </div>;
            })}
            {!invoices.jobs.length && <p className="rounded-xl bg-cream p-4 text-sm text-taupe">No fiscal invoice jobs have been queued.</p>}</div>
          </details>
        </div>}
      </div>}
    </OdooAccordion>
  );
}
