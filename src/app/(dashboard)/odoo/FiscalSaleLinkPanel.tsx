import { formatDateTime } from "@/lib/dates";
import type { FiscalSaleLinkAdminData } from "@/lib/data/odoo-fiscal-sale-links";
import { OdooAccordion } from "./OdooAccordion";
import { OdooSaveForm } from "./OdooSaveForm";
import { requestFiscalSaleLinks } from "./actions";

function statusStyle(status: string) {
  if (status === "completed") return "bg-sage/15 text-sage";
  if (status === "failed") return "bg-danger/10 text-danger";
  return "bg-warning/15 text-warning";
}

export function FiscalSaleLinkPanel({ data, timeZone }: { data: FiscalSaleLinkAdminData; timeZone: string }) {
  const request = data.latestRequest;
  const summary = request?.result?.summary == null ? null : String(request.result.summary);
  const ready = Boolean(data.payload && data.payloadSha256);
  return (
    <OdooAccordion
      title="Invoice to sales-order reconciliation"
      description="Link posted fiscal invoice lines to the exact completed SoftLife production sales-order lines without creating or reposting accounting documents."
      defaultOpen={ready || data.unmapped.length > 0 || request?.status === "failed"}
      badge={<span className={`rounded-full px-3 py-1 text-xs font-bold ${ready ? "bg-warning/15 text-warning" : data.linkedCount === data.postedCount && data.postedCount > 0 ? "bg-sage/15 text-sage" : "bg-taupe/10 text-taupe"}`}>{ready ? `${data.candidateCount} ready` : `${data.linkedCount}/${data.postedCount} linked`}</span>}
    >
      {!data.available ? <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">{data.blockers[0]}</p> : <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-cream p-3 text-xs"><span className="block uppercase text-taupe">Posted invoices</span><strong className="text-cocoa">{data.postedCount}</strong></div>
          <div className="rounded-xl bg-cream p-3 text-xs"><span className="block uppercase text-taupe">Already linked</span><strong className="text-sage">{data.linkedCount}</strong></div>
          <div className="rounded-xl bg-cream p-3 text-xs"><span className="block uppercase text-taupe">Ready now</span><strong className="text-cocoa">{data.candidateCount}</strong></div>
        </div>

        {data.deferredCount > 0 && <p className="rounded-xl bg-warning/10 px-4 py-3 text-xs text-warning">{data.deferredCount} additional invoice link{data.deferredCount === 1 ? "" : "s"} will be available in the next deterministic batch after this request completes.</p>}

        {data.blockers.map((blocker) => <p key={blocker} className="rounded-xl bg-danger/5 px-4 py-3 text-xs font-semibold text-danger">{blocker}</p>)}
        {data.unmapped.length > 0 && <details className="rounded-xl border border-warning/30 bg-warning/5 p-3"><summary className="cursor-pointer text-xs font-bold text-warning">{data.unmapped.length} invoice{data.unmapped.length === 1 ? "" : "s"} require review</summary><ul className="mt-2 space-y-1 text-xs text-taupe">{data.unmapped.slice(0, 50).map((issue) => <li key={issue}>{issue}</li>)}</ul></details>}

        {request && <div className="rounded-xl border border-line p-3 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-cocoa">Latest reconciliation request</strong><span className={`rounded-full px-2 py-1 font-bold ${statusStyle(request.status)}`}>{request.status}</span></div><p className="mt-1 text-taupe">Requested {formatDateTime(request.requested_at, timeZone)} · attempts {request.attempts}{request.completed_at ? ` · completed ${formatDateTime(request.completed_at, timeZone)}` : ""}</p>{summary && <p className="mt-1 text-sage">{summary}</p>}{request.error && <p className="mt-1 text-danger">{request.error}</p>}</div>}

        <OdooSaveForm action={requestFiscalSaleLinks} className="rounded-xl border border-line bg-cream/40 p-4">
          <input type="hidden" name="fiscal_month" value={data.month} />
          <input type="hidden" name="payload_sha256" value={data.payloadSha256 ?? ""} />
          <label className="flex items-start gap-2 text-xs text-cocoa"><input type="checkbox" required name="sale_link_acknowledgement" value="link_existing_fiscal_invoices" className="mt-0.5" /><span>I authorize linking only the reviewed existing posted invoices to their verified SoftLife sales-order lines. No invoice, posting, or accounting amount will be created or changed.</span></label>
          <button disabled={!ready} className="mt-3 rounded-lg bg-cocoa px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Queue {data.candidateCount} verified link{data.candidateCount === 1 ? "" : "s"}</button>
        </OdooSaveForm>
      </div>}
    </OdooAccordion>
  );
}
