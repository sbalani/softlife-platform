import { formatDateTime } from "@/lib/dates";
import type { ProductionAdminData } from "@/lib/data/odoo-production-admin";
import { cancelPlatformPeriod, confirmPlatformPeriod, preparePlatformPeriod } from "./actions";

type Run = ProductionAdminData["runs"][number];

const STATUS_COPY: Record<string, string> = {
  blocked: "Preview only, but its orders remain reserved. Cancel this preview to release them before preparing another run.",
  cancelled: "Cancelled. This run must not be processed.",
  completed: "Odoo reported successful manufacturing, sales, and delivery documents.",
  draft: "Frozen preview only. Nothing has been released to Odoo.",
  failed: "Odoo or preparation reported a failure. Review the result before retrying anything.",
  preparing: "The platform is still building the preview.",
  processing: "Odoo is processing this confirmed run. Do not submit it again.",
  ready: "Confirmed and released for Odoo processing. This does not mean manufacturing has completed.",
};

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function value(value: unknown, fallback = "-") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function RunDetails({ run, displayTimeZone }: { run: Run; displayTimeZone: string }) {
  const warehouses = records(run.payload?.warehouses);
  return (
    <details className="mt-3 rounded-lg border border-line bg-white">
      <summary className="cursor-pointer px-3 py-2 font-bold text-cocoa">Review frozen payload and run history</summary>
      <div className="space-y-4 border-t border-line p-3">
        <dl className="grid gap-2 text-[11px] sm:grid-cols-2">
          <div><dt className="font-bold uppercase text-taupe">Export UUID</dt><dd className="break-all font-mono text-cocoa">{run.id}</dd></div>
          <div><dt className="font-bold uppercase text-taupe">Idempotency key</dt><dd className="break-all font-mono text-cocoa">{run.idempotency_key}</dd></div>
          <div><dt className="font-bold uppercase text-taupe">Frozen hash</dt><dd className="break-all font-mono text-cocoa">{run.payload_sha256 ?? "Not frozen"}</dd></div>
          <div><dt className="font-bold uppercase text-taupe">Reserved order rows</dt><dd className="font-semibold text-cocoa">{run.order_count}</dd></div>
          <div><dt className="font-bold uppercase text-taupe">Run timezone</dt><dd className="text-cocoa">{run.time_zone}</dd></div>
          <div><dt className="font-bold uppercase text-taupe">Odoo document date</dt><dd className="text-cocoa">{run.document_date}</dd></div>
          <div><dt className="font-bold uppercase text-taupe">Created</dt><dd className="text-cocoa">{formatDateTime(run.created_at, displayTimeZone)}</dd></div>
          <div><dt className="font-bold uppercase text-taupe">Confirmed</dt><dd className="text-cocoa">{run.confirmed_at ? formatDateTime(run.confirmed_at, displayTimeZone) : "Not confirmed"}</dd></div>
        </dl>

        <div>
          <h4 className="font-bold text-cocoa">Frozen warehouse production</h4>
          {warehouses.length ? <div className="mt-2 space-y-3">{warehouses.map((warehouse, warehouseIndex) => (
            <div key={`${value(warehouse.odoo_warehouse_id)}-${warehouseIndex}`} className="rounded-lg bg-cream/60 p-3">
              <p className="font-bold text-cocoa">Warehouse Odoo ID {value(warehouse.odoo_warehouse_id)} · Customer Odoo ID {value(warehouse.odoo_customer_id)}</p>
              <div className="mt-2 space-y-2">{records(warehouse.recipes).map((recipe, recipeIndex) => (
                <div key={`${value(recipe.recipe_version_id)}-${recipeIndex}`} className="rounded border border-line bg-white p-2">
                  <p className="font-semibold text-cocoa">{value(recipe.name, "Unnamed recipe")} · {value(recipe.units_sold, "0")} units · {value(recipe.gross_sales, "0")} {value(recipe.currency, "")}</p>
                  <p className="text-[10px] text-taupe">Recipe version {value(recipe.version)} · Finished product Odoo ID {value(recipe.odoo_finished_product_id)}</p>
                  <div className="mt-1 flex flex-wrap gap-1">{records(recipe.components).map((component, componentIndex) => (
                    <span key={`${value(component.odoo_product_id)}-${componentIndex}`} className="rounded bg-sand px-2 py-1 text-[10px] text-cocoa">
                      Odoo {value(component.odoo_product_id)}: {value(component.total_quantity)} {value(component.uom)} total ({value(component.quantity_per_unit)} per unit)
                    </span>
                  ))}</div>
                </div>
              ))}</div>
            </div>
          ))}</div> : <p className="mt-1 text-taupe">No warehouse production is present in this payload.</p>}
        </div>

        {run.blocked_items.length > 0 && <div><h4 className="font-bold text-warning">Blocked items</h4><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-warning/10 p-2 text-[10px] text-cocoa">{JSON.stringify(run.blocked_items, null, 2)}</pre></div>}
        {run.odoo_result && <div><h4 className="font-bold text-cocoa">Odoo result</h4><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-cream p-2 text-[10px] text-cocoa">{JSON.stringify(run.odoo_result, null, 2)}</pre></div>}

        {run.initiated_by === "platform" && run.status === "draft" && run.payload_sha256 && (
          <form action={confirmPlatformPeriod} className="rounded-lg border border-warning/40 bg-warning/10 p-3">
            <input type="hidden" name="export_id" value={run.id} />
            <input type="hidden" name="payload_sha256" value={run.payload_sha256} />
            <p className="font-bold text-cocoa">This releases the frozen payload to Odoo.</p>
            <p className="mt-1 text-[11px] text-cocoa">Odoo may create and validate manufacturing orders, sales orders, deliveries, and stock movements. This is not another preview action.</p>
            <label className="mt-3 flex items-start gap-2 text-[11px] font-semibold text-cocoa"><input type="checkbox" name="release_acknowledgement" value="release_frozen_payload" required className="mt-0.5" />I reviewed the warehouses, recipes, quantities, period, and hash above and intend to release this run.</label>
            <button className="mt-3 rounded bg-cocoa px-3 py-2 text-xs font-bold text-white">Confirm and release to Odoo</button>
          </form>
        )}
        {run.initiated_by === "platform" && (run.status === "draft" || run.status === "blocked") && (
          <form action={cancelPlatformPeriod} className="rounded-lg border border-line p-3">
            <input type="hidden" name="export_id" value={run.id} />
            <label className="flex items-start gap-2 text-[11px] text-cocoa"><input type="checkbox" name="cancel_acknowledgement" value="cancel_unconfirmed_preview" required className="mt-0.5" />Cancel this unconfirmed preview and release its reserved orders. Nothing will be sent to Odoo.</label>
            <button className="mt-2 rounded border border-line bg-white px-3 py-2 text-xs font-bold text-cocoa">Cancel unconfirmed preview</button>
          </form>
        )}
      </div>
    </details>
  );
}

export function ProductionRunsPanel({ runs, timeZone }: { runs: Run[]; timeZone: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <h3 className="text-sm font-bold text-cocoa">Manufacturing runs</h3>
      <p className="mt-1 text-[11px] text-taupe">Preparing calculates and freezes a reviewable payload. It does not release manufacturing work to Odoo.</p>
      <form action={preparePlatformPeriod} className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-xs text-taupe"><span className="mb-1 block">From</span><input name="local_from" type="datetime-local" required className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <label className="text-xs text-taupe"><span className="mb-1 block">To (exclusive)</span><input name="local_to" type="datetime-local" required className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <label className="col-span-2 text-xs text-taupe"><span className="mb-1 block">IANA timezone</span><input name="time_zone" required defaultValue={timeZone} className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <button className="col-span-2 rounded bg-terracotta px-3 py-2 text-xs font-bold text-white">Prepare frozen preview only</button>
      </form>
      <div className="mt-4 max-h-[36rem] space-y-3 overflow-auto">{runs.map((run) => (
        <div key={run.id} className="rounded-lg bg-cream/60 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all font-mono font-semibold text-cocoa">{run.idempotency_key}</span><span className="font-bold uppercase text-taupe">{run.status} · {run.initiated_by}</span></div>
          <p className="mt-1 font-semibold text-cocoa">{STATUS_COPY[run.status] ?? "Review this run before taking another action."}</p>
          <p className="mt-1 text-taupe">{formatDateTime(run.period_from, run.time_zone)} to {formatDateTime(run.period_to, run.time_zone)} ({run.time_zone}, end exclusive) · {run.order_count} reserved order rows{run.blocked_items.length ? ` · ${run.blocked_items.length} blocker findings` : ""}</p>
          <RunDetails run={run} displayTimeZone={timeZone} />
        </div>
      ))}{!runs.length && <p className="text-sm text-taupe">No manufacturing runs prepared.</p>}</div>
    </div>
  );
}
