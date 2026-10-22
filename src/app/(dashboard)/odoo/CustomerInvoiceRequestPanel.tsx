import type { CustomerInvoiceRequestAdmin } from "@/lib/data/customer-invoice-requests";
import { OdooAccordion } from "./OdooAccordion";
import { OdooSaveForm } from "./OdooSaveForm";
import { recordCustomerInvoiceRequest } from "./actions";

const fieldClass = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa";

export function CustomerInvoiceRequestPanel({ available, requests }: { available: boolean; requests: CustomerInvoiceRequestAdmin[] }) {
  return <OdooAccordion title="Customer invoice requests" description="Record a customer's accepted fiscal identity against one post-cutover source order before freezing the month." defaultOpen={false} badge={<span className={`rounded-full px-3 py-1 text-xs font-bold ${available ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>{available ? `${requests.length} recorded` : "Migration pending"}</span>}>
    {!available ? <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">Apply the September 2026 Odoo cutover migration before recording requests.</p> : <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.8fr)]">
      <OdooSaveForm action={recordCustomerInvoiceRequest} className="rounded-xl border border-line p-4">
        <h3 className="text-sm font-bold text-cocoa">Accept and freeze a request</h3>
        <p className="mt-1 text-[11px] text-taupe">Verify the source order and all legal details. Acceptance is permanent and only one request can be accepted per order.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-taupe"><span className="mb-1 block">Source order code</span><input name="order_code" required maxLength={100} className={fieldClass} /></label>
          <label className="text-xs text-taupe"><span className="mb-1 block">Legal name</span><input name="legal_name" required maxLength={200} className={fieldClass} /></label>
          <label className="text-xs text-taupe"><span className="mb-1 block">Tax ID / NIF</span><input name="tax_id" required maxLength={50} className={fieldClass} /></label>
          <label className="text-xs text-taupe"><span className="mb-1 block">Invoice email</span><input name="email" type="email" required maxLength={254} className={fieldClass} /></label>
          <label className="text-xs text-taupe sm:col-span-2"><span className="mb-1 block">Address</span><input name="address" required maxLength={300} className={fieldClass} /></label>
          <label className="text-xs text-taupe"><span className="mb-1 block">Postal code</span><input name="postal_code" required maxLength={20} className={fieldClass} /></label>
          <label className="text-xs text-taupe"><span className="mb-1 block">City</span><input name="city" required maxLength={100} className={fieldClass} /></label>
          <label className="text-xs text-taupe"><span className="mb-1 block">Province</span><input name="province" required maxLength={100} className={fieldClass} /></label>
          <label className="text-xs text-taupe"><span className="mb-1 block">Country code</span><input name="country_code" required pattern="[A-Za-z]{2}" maxLength={2} defaultValue="ES" className={`${fieldClass} uppercase`} /></label>
        </div>
        <button className="mt-4 rounded-lg bg-terracotta px-4 py-2 text-xs font-bold text-white">Accept immutable request</button>
      </OdooSaveForm>
      <div className="rounded-xl border border-line p-4"><h3 className="text-sm font-bold text-cocoa">Latest accepted requests</h3><div className="mt-3 max-h-[30rem] space-y-2 overflow-auto">
        {requests.map((request) => <details key={request.id} className="rounded-lg bg-cream/60 p-3 text-xs"><summary className="cursor-pointer font-semibold text-cocoa">{request.order_code} · {request.fiscal_details.legal_name}</summary><dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-taupe"><dt>Tax ID</dt><dd>{request.fiscal_details.tax_id}</dd><dt>Email</dt><dd>{request.fiscal_details.email}</dd><dt>Address</dt><dd>{request.fiscal_details.address}, {request.fiscal_details.postal_code} {request.fiscal_details.city}, {request.fiscal_details.province} ({request.fiscal_details.country_code})</dd><dt>Hash</dt><dd className="break-all font-mono text-[9px]">{request.fiscal_details_sha256}</dd></dl></details>)}
        {!requests.length && <p className="text-sm text-taupe">No accepted requests yet.</p>}
      </div></div>
    </div>}
  </OdooAccordion>;
}
