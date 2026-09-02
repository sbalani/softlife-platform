import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import type { ProductionAdminData } from "@/lib/data/odoo-production-admin";
import { cancelPlatformPeriod, confirmPlatformPeriod, preparePlatformPeriod } from "./actions";
import { RunSubmitButton } from "./RunSubmitButton";

type Run = ProductionAdminData["runs"][number];

const STATUS_COPY: Record<string, string> = {
  blocked: "Preview only. Review the blocker findings before preparing another run.",
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

function blockerMessage(item: Record<string, unknown>) {
  if (item.problem_code === "already_in_production_run") return "Reserved by another manufacturing run.";
  if (item.problem_code === "missing_warehouse_customer") return `Odoo warehouse ${value(item.odoo_warehouse_id)} has no sales customer mapping.`;
  if (item.problem_code === "unknown_ingredient_name") return `Unknown ingredient: ${value(item.raw_text)}.`;
  return value(item.message, value(item.problem_code, "Unknown preparation problem"));
}

function BlockedItems({ items }: { items: Record<string, unknown>[] }) {
  return <div>
    <h4 className="font-bold text-warning">Blocked items</h4>
    <div className="mt-2 space-y-2">{items.map((item, index) => {
      const ownerId = String(item.blocking_export_id ?? "");
      return <div key={`${value(item.order_id)}-${index}`} className="rounded border border-warning/30 bg-warning/10 p-2 text-[11px] text-cocoa">
        <p className="font-semibold">{value(item.machine, "Unknown machine")} · order {value(item.order_code, value(item.order_id))}</p>
        <p>{blockerMessage(item)}</p>
        {ownerId && <p className="mt-1">Owner run: <Link href={`#run-${ownerId}`} className="break-all font-mono font-semibold underline">{value(item.blocking_idempotency_key, ownerId)}</Link>{item.blocking_status ? ` (${value(item.blocking_status)})` : ""}</p>}
      </div>;
    })}</div>
  </div>;
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
                    <span key={`${value(component.odoo_product_id)}-${componentIndex}`} className="contents">
                      <span className="rounded bg-sand px-2 py-1 text-[10px] text-cocoa">
                        Odoo {value(component.odoo_product_id)}: {value(component.total_quantity)} {value(component.uom)} physical ({value(component.quantity_per_unit)} per sale)
                      </span>
                      {component.stock_quantity_per_unit != null && <span className="rounded bg-sage/10 px-2 py-1 text-[10px] text-cocoa">
                        Odoo stock: {value(component.stock_total_quantity)} {value(component.stock_uom)} total ({value(component.stock_quantity_per_unit)} per sale){component.package_content_quantity != null ? ` · 1 unit = ${value(component.package_content_quantity)} ${value(component.package_content_uom)}` : ""}
                      </span>}
                    </span>
                  ))}</div>
                </div>
              ))}</div>
            </div>
          ))}</div> : <p className="mt-1 text-taupe">No warehouse production is present in this payload.</p>}
        </div>

        {run.blocked_items.length > 0 && <BlockedItems items={run.blocked_items} />}
        {run.odoo_result && <div><h4 className="font-bold text-cocoa">Odoo result</h4><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-cream p-2 text-[10px] text-cocoa">{JSON.stringify(run.odoo_result, null, 2)}</pre></div>}

        {run.initiated_by === "platform" && run.status === "draft" && run.payload_sha256 && (
          <form action={confirmPlatformPeriod} className="rounded-lg border border-warning/40 bg-warning/10 p-3">
            <input type="hidden" name="export_id" value={run.id} />
            <input type="hidden" name="payload_sha256" value={run.payload_sha256} />
            <p className="font-bold text-cocoa">This releases the frozen payload to Odoo.</p>
            <p className="mt-1 text-[11px] text-cocoa">Odoo may create and validate manufacturing orders, sales orders, deliveries, and stock movements. This is not another preview action.</p>
            <label className="mt-3 flex items-start gap-2 text-[11px] font-semibold text-cocoa"><input type="checkbox" name="release_acknowledgement" value="release_frozen_payload" required className="mt-0.5" />I reviewed the warehouses, recipes, quantities, period, and hash above and intend to release this run.</label>
            <RunSubmitButton idle="Confirm and release to Odoo" pending="Releasing to Odoo..." className="mt-3 rounded bg-cocoa px-3 py-2 text-xs font-bold text-white" />
          </form>
        )}
        {run.initiated_by === "platform" && (run.status === "draft" || run.status === "blocked") && (
          <form action={cancelPlatformPeriod} className="rounded-lg border border-line p-3">
            <input type="hidden" name="export_id" value={run.id} />
            <label className="flex items-start gap-2 text-[11px] text-cocoa"><input type="checkbox" name="cancel_acknowledgement" value="cancel_unconfirmed_preview" required className="mt-0.5" />{run.order_count ? "Cancel this unconfirmed preview and release its reserved orders." : "Remove this empty, unconfirmed preview."} Nothing will be sent to Odoo.</label>
            <RunSubmitButton idle={run.order_count ? "Cancel unconfirmed preview" : "Remove empty preview"} pending="Cancelling preview..." className="mt-2 rounded border border-line bg-white px-3 py-2 text-xs font-bold text-cocoa" />
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
        <input type="hidden" name="request_id" value={crypto.randomUUID()} />
        <label className="text-xs text-taupe"><span className="mb-1 block">From date (included)</span><input name="date_from" type="date" required className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <label className="text-xs text-taupe"><span className="mb-1 block">Through date (included)</span><input name="date_to" type="date" required className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <label className="col-span-2 text-xs text-taupe"><span className="mb-1 block">IANA timezone</span><input name="time_zone" required defaultValue={timeZone} className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <RunSubmitButton idle="Prepare frozen preview only" pending="Preparing frozen preview..." className="col-span-2 rounded bg-terracotta px-3 py-2 text-xs font-bold text-white" />
        <p className="col-span-2 text-[11px] text-taupe">Preparation can take a few minutes. Keep this page open; the button stays disabled while the frozen payload is built.</p>
      </form>
      <div className="mt-4 max-h-[36rem] space-y-3 overflow-auto">{runs.map((run) => (
        <div id={`run-${run.id}`} key={run.id} className="scroll-mt-4 rounded-lg bg-cream/60 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all font-mono font-semibold text-cocoa">{run.idempotency_key}</span><span className="font-bold uppercase text-taupe">{run.status} · {run.initiated_by}</span></div>
          <p className="mt-1 font-semibold text-cocoa">{run.status === "blocked" && !run.order_count && run.blocked_items.length > 0 && run.blocked_items.every((item) => item.problem_code === "already_in_production_run") ? "This duplicate reserved no orders and sent nothing to Odoo. It can be removed safely." : STATUS_COPY[run.status] ?? "Review this run before taking another action."}</p>
          <p className="mt-1 text-taupe">{formatDateTime(run.period_from, run.time_zone)} to {formatDateTime(run.period_to, run.time_zone)} ({run.time_zone}, end exclusive) · {run.order_count} reserved order rows{run.blocked_items.length ? ` · ${run.blocked_items.length} blocker findings` : ""}</p>
          <RunDetails run={run} displayTimeZone={timeZone} />
        </div>
      ))}{!runs.length && <p className="text-sm text-taupe">No manufacturing runs prepared.</p>}</div>
    </div>
  );
}
