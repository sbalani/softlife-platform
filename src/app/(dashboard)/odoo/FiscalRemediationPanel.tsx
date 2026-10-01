import { formatDateTime } from "@/lib/dates";
import type { FiscalRemediationPreview } from "@/lib/odoo-fiscal-remediation";
import { requestFiscalProductRemediation } from "./actions";
import { OdooSaveForm } from "./OdooSaveForm";
import { OdooAccordion } from "./OdooAccordion";

function taxLabel(taxes: FiscalRemediationPreview["products"][number]["observed_sale_taxes"]) {
  if (!taxes.length) return "No effective customer taxes";
  return taxes.map((tax) => `ID ${tax.odoo_tax_id}: ${tax.rate}% ${tax.country_code} ${tax.type_tax_use}/${tax.amount_type}`).join("; ");
}

export function FiscalRemediationPanel({ data, timeZone }: { data: FiscalRemediationPreview; timeZone: string }) {
  const request = data.latestRequest;
  const resultSummary = request?.result?.summary == null ? null : String(request.result.summary);
  return <OdooAccordion title="Fiscal product remediation" description="Preview a frozen, connector-executed correction for active recipe products whose effective income account or customer tax does not match fiscal preflight." defaultOpen={Boolean(data.payload || data.blockers.length)} badge={
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${data.payload ? "bg-warning/15 text-warning" : data.blockers.length ? "bg-danger/10 text-danger" : "bg-sage/15 text-sage"}`}>
        {data.payload ? `${data.products.length} ready to remediate` : data.blockers.length ? "Blocked" : "No changes"}
    </span>
  }>

    {!data.available ? <p className="mt-4 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">Apply the fiscal product remediation queue migration before using this control.</p> : <div className="mt-4 space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-line p-4 text-xs">
          <h3 className="font-bold text-cocoa">Immutable source</h3>
          {data.report ? <div className="mt-2 space-y-1 text-taupe">
            <p>Odoo checked {formatDateTime(data.report.checked_at, timeZone)}</p>
            <p className="break-all font-mono text-[9px]">Report {data.report.id}</p>
            <p className="break-all font-mono text-[9px]">SHA-256 {data.report.payload_sha256}</p>
          </div> : <p className="mt-2 text-warning">No fiscal configuration report is available.</p>}
        </div>
        <div className="rounded-xl border border-line p-4 text-xs">
          <h3 className="font-bold text-cocoa">Latest remediation request</h3>
          {!request ? <p className="mt-2 text-taupe">No fiscal product remediation has been queued.</p> : <div className="mt-2 space-y-1 text-taupe">
            <p><span className="font-semibold uppercase text-cocoa">{request.status}</span> - requested {formatDateTime(request.requested_at, timeZone)} - attempts {request.attempts}</p>
            {request.claimed_at && <p>Odoo claimed it at {formatDateTime(request.claimed_at, timeZone)}.</p>}
            {request.completed_at && <p>Finished at {formatDateTime(request.completed_at, timeZone)}.</p>}
            {resultSummary && <p className="whitespace-pre-wrap text-cocoa">{resultSummary}</p>}
            {request.error && <p className="whitespace-pre-wrap font-semibold text-danger">{request.error}</p>}
            <p className="break-all font-mono text-[9px]">{request.id}</p>
          </div>}
        </div>
      </div>

      {data.blockers.length > 0 && <div className="rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs text-danger">{data.blockers.map((blocker) => <p key={blocker}>{blocker}</p>)}</div>}
      {data.missingProducts.length > 0 && <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs">
        <h3 className="font-bold text-warning">Active recipe products missing from the report</h3>
        {data.missingProducts.map((product) => <p key={product.odoo_product_id} className="mt-1 text-cocoa">Odoo {product.odoo_product_id}: {product.names.join(", ")}</p>)}
      </div>}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-sand/50 uppercase text-taupe"><tr><th className="px-3 py-2">Product</th><th>Income account</th><th>Effective customer taxes</th></tr></thead>
          <tbody className="divide-y divide-line">{data.products.map((product) => <tr key={product.odoo_product_id}>
            <td className="px-3 py-3 text-cocoa"><strong>{product.names.join(", ")}</strong><span className="block text-[10px] text-taupe">Odoo {product.odoo_product_id}</span></td>
            <td className="pr-3 text-cocoa">{product.observed_income_account_code ?? "Missing"} <span className="text-taupe">to</span> {data.target?.income_account.code ?? "Unavailable"}{!product.remediate_income_account && <span className="block text-[10px] text-sage">Already matches</span>}</td>
            <td className="max-w-md py-3 pr-3 text-cocoa">{taxLabel(product.observed_sale_taxes)}<span className="block text-[10px] text-taupe">to {data.target ? `ID ${data.target.sale_tax.odoo_tax_id}: ${data.target.sale_tax.rate}% ${data.target.sale_tax.country_code} ${data.target.sale_tax.type_tax_use}/${data.target.sale_tax.amount_type}` : "Unavailable"}</span>{!product.remediate_customer_taxes && <span className="block text-[10px] text-sage">Already has a matching effective tax</span>}</td>
          </tr>)}</tbody>
        </table>
        {!data.products.length && <p className="p-4 text-sm text-taupe">No reported active recipe products currently fail the effective account or tax checks.</p>}
      </div>

      <OdooSaveForm action={requestFiscalProductRemediation} className="rounded-xl border border-danger/30 bg-danger/5 p-4">
        <input type="hidden" name="configuration_report_id" value={data.report?.id ?? ""} />
        <input type="hidden" name="configuration_payload_sha256" value={data.report?.payload_sha256 ?? ""} />
        <p className="text-sm font-bold text-danger">This writes fiscal configuration on the listed Odoo products. It cannot create or post invoices.</p>
        <label className="mt-3 flex items-start gap-2 text-xs text-cocoa">
          <input type="checkbox" name="remediation_acknowledgement" value="write_odoo_product_fiscal_configuration" required disabled={!data.payload} className="mt-0.5" />
          I reviewed the immutable source, every affected product, and each observed-to-target account and tax change.
        </label>
        <button disabled={!data.payload} className="mt-3 rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Queue frozen Odoo product remediation</button>
      </OdooSaveForm>
    </div>}
  </OdooAccordion>;
}
