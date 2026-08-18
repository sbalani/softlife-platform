import Link from "next/link";
import { getLotUsages, getProvenanceGaps } from "@/lib/data/lot-audit";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getSessionProfile } from "@/lib/auth/session";
import { accessibleMachineIds } from "@/lib/data/service-access";
import { createServiceClient } from "@/lib/supabase/server";
import { AllocationForm } from "@/components/AllocationForm";

export const dynamic = "force-dynamic";

type SP = { dateFrom?: string; dateTo?: string; machine?: string; productType?: string; lotName?: string };

const TYPE_TONE: Record<string, string> = {
  base: "bg-terracotta/15 text-terracotta",
  topping: "bg-sage/15 text-sage",
  sauce: "bg-rose/15 text-rose",
};

export default async function LotAuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await getSessionProfile();
  const machineIds = session ? await accessibleMachineIds(await createServiceClient(), session) : [];
  const tenantId = session?.role === "admin" ? undefined : session?.tenant_id ?? "no-tenant";
  const [usages, gaps, tz] = await Promise.all([
    getLotUsages(sp, { machineIds: machineIds ?? undefined, tenantId }),
    getProvenanceGaps({ machineIds: machineIds ?? undefined, tenantId }),
    getDisplayTimezone(),
  ]);

  const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
  const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-cocoa">Lot Audit</h1>
        <p className="mt-1 text-sm text-taupe">{usages.length} resolved lot load / usage record{usages.length === 1 ? "" : "s"} from Action Reports and manual hopper updates</p>
      </header>

      <section className="mb-7">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="font-display text-xl font-bold text-cocoa">Provenance Gaps</h2><p className="text-sm text-taupe">Physical refills that were preserved but still need a warehouse, transfer, lot, or stock allocation.</p></div>
          <Link href="/refills" className="text-sm font-bold text-terracotta hover:underline">Open Action Report</Link>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe"><tr><th className="px-4 py-3">Occurred / recorded</th><th className="px-4 py-3">Machine / operator</th><th className="px-4 py-3">Warehouse</th><th className="px-4 py-3">Product / lot</th><th className="px-4 py-3">Physical / allocated</th><th className="px-4 py-3">Gap and reconciliation</th></tr></thead>
            <tbody className="divide-y divide-line">
              {gaps.map((gap) => <tr key={gap.id} className="align-top"><td className="px-4 py-3 text-cocoa">{formatDateTime(gap.occurred_at, tz)}<span className="mt-1 block text-xs text-taupe">Recorded {formatDateTime(gap.recorded_at, tz)}</span></td><td className="px-4 py-3 font-semibold text-cocoa">{gap.machine_name}<span className="mt-1 block text-xs font-normal text-taupe">{gap.operator_name ?? "Unknown operator"}</span><Link href={`/refills#${gap.report_id}`} className="mt-1 block text-xs text-terracotta hover:underline">Report {gap.report_id.slice(0, 8)}</Link></td><td className="px-4 py-3 text-cocoa">{gap.warehouse_name ?? "Unassigned"}</td><td className="px-4 py-3 text-cocoa">{gap.product_name ?? "Unknown product"}<span className="ml-2 font-mono text-xs text-taupe">{gap.lot_code ?? "lot unknown"}</span></td><td className="px-4 py-3 text-cocoa">{gap.quantity} {gap.unit}<span className="mt-1 block text-xs text-taupe">{gap.allocated_quantity} allocated · {gap.outstanding_quantity} outstanding</span></td><td className="px-4 py-3 text-warning"><span className="rounded-full bg-warning/10 px-2 py-1 text-[10px] font-bold uppercase text-warning">{gap.status.replaceAll("_", " ")}</span><span className="ml-2 text-xs">{(gap.reason ?? "other").replaceAll("_", " ")}</span>{gap.assigned_warehouse_id !== null && gap.outstanding_quantity > 0 && <AllocationForm lineId={gap.id} warehouseId={gap.assigned_warehouse_id} physicalUnit={gap.unit} outstanding={gap.outstanding_quantity} candidates={gap.candidates} />}</td></tr>)}
              {gaps.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-taupe">No unresolved provenance gaps.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Filters */}
      <form className="mb-4 flex flex-wrap items-end gap-3">
        <label className="block"><span className={label}>From</span><input name="dateFrom" type="date" defaultValue={sp.dateFrom} className={input} /></label>
        <label className="block"><span className={label}>To</span><input name="dateTo" type="date" defaultValue={sp.dateTo} className={input} /></label>
        <label className="block"><span className={label}>Machine</span><input name="machine" defaultValue={sp.machine} placeholder="Name or IMEI" className={`w-40 ${input}`} /></label>
        <label className="block"><span className={label}>Product type</span>
          <select name="productType" defaultValue={sp.productType ?? ""} className={input}>
            <option value="">All</option>
            <option value="base">Base</option>
            <option value="topping">Topping</option>
            <option value="sauce">Sauce</option>
          </select>
        </label>
        <label className="block"><span className={label}>Lot name</span><input name="lotName" defaultValue={sp.lotName} placeholder="LOT-2026-…" className={`w-40 ${input}`} /></label>
        <button type="submit" className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90">Filter</button>
        <Link href="/lot-audit" className="text-sm font-semibold text-terracotta hover:underline">Clear</Link>
      </form>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-4 py-3 font-bold">Date</th>
              <th className="px-4 py-3 font-bold">Machine</th>
              <th className="px-4 py-3 font-bold">Position</th>
              <th className="px-4 py-3 font-bold">Product</th>
              <th className="px-4 py-3 font-bold">Type</th>
              <th className="px-4 py-3 font-bold">Lot</th>
              <th className="px-4 py-3 text-right font-bold">Qty</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {usages.map((u) => (
              <tr key={u.id} className="hover:bg-cream/50">
                <td className="px-4 py-3 text-cocoa">{formatDateTime(u.device_event_time, tz)}</td>
                <td className="px-4 py-3 font-semibold text-cocoa">{u.machine_name ?? u.device_imei ?? "—"}</td>
                <td className="px-4 py-3 text-taupe">{u.position ?? "—"}</td>
                <td className="px-4 py-3 text-cocoa">{u.product_name ?? "—"}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${TYPE_TONE[u.product_type] ?? "bg-cream text-taupe"}`}>{u.product_type}</span></td>
                <td className="px-4 py-3 font-mono text-xs text-cocoa">{u.lot_name}</td>
                <td className="px-4 py-3 text-right text-cocoa">{u.quantity ?? "—"}</td>
              </tr>
            ))}
            {usages.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-taupe">No lot usage records match your filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
