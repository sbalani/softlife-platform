import Link from "next/link";
import { getMachines } from "@/lib/data/machines";
import { getActionReportDraft, getActionReportHistory, getActionReportLots } from "@/lib/data/action-reports";
import { ActionReportForm } from "@/components/ActionReportForm";
import { formatDateTime } from "@/lib/dates";
import { actionReportModesLabel } from "@/lib/action-report-modes";
import { getDisplayTimezone } from "@/lib/timezone";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { accessibleMachineIds } from "@/lib/data/service-access";
import { ActionReportStockRetry } from "@/components/ActionReportStockRetry";

export const dynamic = "force-dynamic";

export default async function RefillsPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const { draft: draftId } = await searchParams;
  const session = await getSessionProfile();
  const s = await createServiceClient();
  const [{ machines: allMachines }, allowedIds] = await Promise.all([
    getMachines(),
    session ? accessibleMachineIds(s, session) : Promise.resolve([]),
  ]);
  const machines = allowedIds ? allMachines.filter((machine) => allowedIds.includes(machine.id)) : allMachines;
  const { data: machineRows, error: machineError } = machines.length
    ? await s.from("machines").select("id,odoo_warehouse_id").in("id", machines.map((machine) => machine.id))
    : { data: [], error: null };
  if (machineError) throw machineError;
  const warehouseByMachine = new Map(((machineRows as { id: string; odoo_warehouse_id: number | null }[]) ?? []).map((row) => [row.id, row.odoo_warehouse_id]));
  const warehouseIds = [...new Set([...warehouseByMachine.values()].filter((id): id is number => id !== null))];
  const tenantId = session?.role === "admin" ? undefined : session?.tenant_id ?? "no-tenant";
  const [lots, history, tz, requestedDraft] = await Promise.all([
    getActionReportLots(warehouseIds),
    getActionReportHistory({
      machineIds: allowedIds ?? undefined,
      tenantId,
      actorId: session?.role === "admin" ? undefined : session?.id,
    }),
    getDisplayTimezone(),
    draftId ? getActionReportDraft(draftId, tenantId, session?.role === "admin" ? undefined : session?.id) : Promise.resolve(null),
  ]);
  const draft = requestedDraft && machines.some((machine) => machine.id === requestedDraft.machineId) ? requestedDraft : null;

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Action Report</h1>
        <p className="mt-1 text-sm text-taupe">Record cleaning, refills, or other physical service work even when inventory provenance is incomplete.</p>
      </header>

      <section className="mb-8 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">New report</h2>
        <ActionReportForm
          machines={machines.map((machine) => ({ id: machine.id, name: machine.name, warehouseId: warehouseByMachine.get(machine.id) ?? null }))}
          lots={lots}
          initialEventTime={new Date().toISOString()}
          initialDraft={draft}
        />
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Recent reports ({history.length})</h2>
        {history.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white p-10 text-center text-taupe">
            No Action Reports logged yet.
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((r) => (
              <article key={r.id} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-display text-base font-bold text-cocoa">{r.machineName}</span>
                    <span className="ml-2 rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold uppercase text-taupe">{actionReportModesLabel(r.actionModes)}</span>
                  </div>
                  <span className="text-xs text-taupe">{formatDateTime(r.occurredAt, tz)} · {r.status} · provenance {r.provenanceStatus.replace("_", " ")}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.refillLines.map((l, i) => (
                    <span key={i} className="rounded-full bg-cream px-2.5 py-1 text-xs text-cocoa">
                      {l.lotCode ?? l.productName ?? "Unknown lot"} · {l.quantity} {l.unit} · {l.provenanceStatus.replace("_", " ")}
                    </span>
                  ))}
                  {r.refillLines.length === 0 && <span className="text-xs text-taupe">{r.notes ?? "No refill lines."}</span>}
                </div>
                {r.stockSnapshot && <details className="mt-3 rounded-lg bg-sage/5 px-3 py-2"><summary className="cursor-pointer text-xs font-bold text-sage">Menu stock baseline · {r.stockSnapshot.items.length} items · {formatDateTime(r.stockSnapshot.capturedAt, tz)} · {r.stockSnapshot.status.replace("_", " ")}</summary><div className="mt-2 flex flex-wrap gap-2">{r.stockSnapshot.items.map((item) => <span key={`${item.menuKind}:${item.position}`} className="rounded-full bg-white px-2.5 py-1 text-xs text-cocoa">{item.goodsName || `${item.menuKind} ${item.position}`} · stock {item.stockCount ?? "unreadable"}</span>)}</div></details>}
                {r.status === "confirmed" && r.actionModes.includes("refill") && !r.stockSnapshot && (r.canRetryStockSnapshot ? <ActionReportStockRetry reportId={r.id} /> : <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">This confirmed refill has no menu-stock baseline.</p>)}
                {r.status === "draft" && <div className="mt-3"><Link href={`/refills?draft=${r.id}#action-report-form`} className="text-sm font-bold text-terracotta hover:underline">Resume draft</Link></div>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
