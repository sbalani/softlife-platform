import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import type { ProductionAdminData } from "@/lib/data/odoo-production-admin";
import { manufacturingOverlapGuidance } from "@/lib/manufacturing-overlap";
import { cancelPlatformPeriod, confirmPlatformPeriod, confirmPlatformReplenishment, preparePlatformPeriod, resolveProductionOrdersToRecipe, retryPlatformReplenishment } from "./actions";
import { RunSubmitButton } from "./RunSubmitButton";
import { OdooSaveForm } from "./OdooSaveForm";
import { ManufacturingPreparationRefresh } from "./ManufacturingPreparationRefresh";

type Run = ProductionAdminData["runs"][number];

const STATUS_COPY: Record<string, string> = {
  blocked: "Preview only. Review the blocker findings before preparing another run.",
  cancelled: "Cancelled. This run must not be processed.",
  completed: "Odoo reported successful manufacturing, sales, and delivery documents.",
  draft: "Frozen preview only. Nothing has been released to Odoo.",
  failed: "Odoo or preparation reported a failure. Review the result before retrying anything.",
  preparing: "The platform is still building the preview.",
  processing: "Odoo is processing this confirmed run. Do not submit it again.",
  replenishment_failed: "Odoo rejected or rolled back the replenishment. Review the structured result before retrying.",
  replenishment_planning: "Stock shortages require internal transfers. Select source lots and confirm replenishment before manufacturing.",
  replenishment_ready: "Replenishment is confirmed and waiting for Odoo to complete every internal transfer.",
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
  if (item.problem_code === "invalid_stock_conversion") return `${value(item.ingredient_name, "Ingredient")} (Odoo ID ${value(item.ingredient_odoo_id)}) cannot convert its physical portion into ${value(item.odoo_stock_uom, "the Odoo stock UoM")}. ${value(item.message, "Review its mirrored net content.")}`;
  if (item.problem_code === "missing_recipe") return "These sale lines do not resolve to one complete recipe. Choose the complete recipe below.";
  return value(item.message, value(item.problem_code, "Unknown preparation problem"));
}

function BlockedItems({ items, recipes, remediable, exportId }: { items: Record<string, unknown>[]; recipes: { id: string; name: string }[]; remediable: boolean; exportId: string }) {
  const overlapRuns = new Map<string, Record<string, unknown>>();
  for (const item of items.filter((candidate) => candidate.problem_code === "already_in_production_run" && candidate.blocking_export_id)) {
    overlapRuns.set(String(item.blocking_export_id), item);
  }
  const recipeGroups = new Map<string, { items: Record<string, unknown>[]; evidence: Record<string, unknown>[]; suggestions: Record<string, unknown>[] }>();
  for (const item of items.filter((candidate) => candidate.problem_code === "missing_recipe" && candidate.order_id)) {
    const evidence = records(item.resolution_evidence);
    const suggestions = records(item.recipe_suggestions);
    const signature = evidence.length
      ? `${value(item.machine)}:${evidence.map((line) => [
        value(line.raw_position), value(line.raw_name), value(line.mapping_method), value(line.resolution_status),
        value(line.platform_product_id), value(line.recipe_id),
      ].join(":")).sort().join("|")}`
      : String(item.order_id);
    const group = recipeGroups.get(signature) ?? { items: [], evidence, suggestions };
    group.items.push(item);
    recipeGroups.set(signature, group);
  }
  const recipeNames = new Map(recipes.map((recipe) => [recipe.id, recipe.name]));
  const groups = [...recipeGroups.entries()].map(([signature, group], index) => {
    const manuallyResolved = group.evidence.filter((line) => line.mapping_method === "manual" && line.resolution_status === "resolved" && line.recipe_id);
    const appliedRecipeId = manuallyResolved.length === 1 && group.evidence.every((line) => ["resolved", "ignored"].includes(String(line.resolution_status)))
      ? String(manuallyResolved[0].recipe_id) : null;
    const suggestion = group.suggestions.find((candidate) => Number(candidate.confidence) >= 50 && recipeNames.has(String(candidate.recipe_id)));
    return { ...group, signature, index, appliedRecipeId, suggestion };
  });
  const pendingGroups = groups.filter((group) => !group.appliedRecipeId);
  return <div>
    <h4 className="font-bold text-warning">Blocked items</h4>
    {[...overlapRuns.values()].map((item) => {
      const guidance = manufacturingOverlapGuidance({
        periodFrom: String(item.blocking_period_from ?? ""), periodTo: String(item.blocking_period_to ?? ""),
        timeZone: String(item.blocking_time_zone ?? "Europe/Madrid"), status: String(item.blocking_status ?? ""),
      });
      return guidance && <p key={String(item.blocking_export_id)} className="mt-2 rounded border border-warning/40 bg-warning/10 p-2 text-[11px] font-semibold text-cocoa">
        {guidance} Owner: <Link href={`#run-${String(item.blocking_export_id)}`} className="font-mono underline">{value(item.blocking_idempotency_key, String(item.blocking_export_id))}</Link> ({value(item.blocking_status)}).
      </p>;
    })}
    <div className="mt-2 space-y-2">{items.map((item, index) => {
      const ownerId = String(item.blocking_export_id ?? "");
      const evidence = records(item.resolution_evidence);
      const appliedRecipe = evidence.find((line) => line.mapping_method === "manual" && line.resolution_status === "resolved" && line.recipe_id);
      return <div key={`${value(item.order_id)}-${index}`} className={`rounded border p-2 text-[11px] text-cocoa ${appliedRecipe ? "border-sage/30 bg-sage/5" : "border-warning/30 bg-warning/10"}`}>
        <p className="font-semibold">{value(item.machine, "Unknown machine")} · order {value(item.order_code, value(item.order_id))}</p>
        <p>{appliedRecipe ? `Durable assignment saved: ${value(appliedRecipe.recipe_name, String(appliedRecipe.recipe_id))}. This frozen preview remains unchanged.` : blockerMessage(item)}</p>
        {item.problem_code === "invalid_stock_conversion" && <p className="mt-1 text-taupe">Mirror value: {item.package_content_quantity == null ? "not present" : `1 unit = ${value(item.package_content_quantity)} ${value(item.package_content_uom)}`}. <Link href="#production-conversion" className="font-semibold underline">Review ingredient conversion</Link></p>}
        {evidence.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{evidence.map((line, lineIndex) => <span key={`${value(line.line_index)}-${lineIndex}`} className="rounded bg-white/70 px-1.5 py-0.5">{value(line.raw_name, "Unnamed line")} · position {value(line.raw_position)} → {value(line.recipe_name, value(line.ingredient_name, value(line.mapping_method)))}</span>)}</div>}
        {ownerId && <p className="mt-1">Owner run: <Link href={`#run-${ownerId}`} className="break-all font-mono font-semibold underline">{value(item.blocking_idempotency_key, ownerId)}</Link>{item.blocking_status ? ` (${value(item.blocking_status)})` : ""}</p>}
      </div>;
    })}</div>
    {remediable && groups.length > 0 && <OdooSaveForm action={resolveProductionOrdersToRecipe} className="mt-3 space-y-2">
      <input type="hidden" name="export_id" value={exportId} />
      {groups.map((group) => <div key={group.signature} className={`rounded-lg border p-3 ${group.appliedRecipeId ? "border-sage/30 bg-sage/5" : "border-terracotta/30 bg-white"}`}>
        <p className="font-semibold text-cocoa">{group.appliedRecipeId ? "Applied to" : "Resolve"} {group.items.length} matching {value(group.items[0].machine, "machine")} order{group.items.length === 1 ? "" : "s"}</p>
        <p className="mt-1 text-[10px] text-taupe">{group.evidence.map((line) => `${value(line.raw_name, "Unnamed line")} (position ${value(line.raw_position)})`).join(" + ") || "No line evidence available"}</p>
        {group.appliedRecipeId ? <p className="mt-2 text-xs font-bold text-sage">Applied: {recipeNames.get(group.appliedRecipeId) ?? group.appliedRecipeId}</p> : <>
          <input type="hidden" name="assignment_index" value={group.index} />
          {group.items.map((item) => <input key={String(item.order_id)} type="hidden" name={`order_id_${group.index}`} value={String(item.order_id)} />)}
          {group.suggestion && <p className="mt-2 text-[10px] font-semibold text-sage">Suggested at {value(group.suggestion.confidence)}% confidence: {value(group.suggestion.recipe_name)} · {value(group.suggestion.matched_components, "0")} matched, {value(group.suggestion.missing_components, "0")} missing, {value(group.suggestion.extra_components, "0")} extra</p>}
          <div className="mt-2 flex gap-2"><select name={`recipe_id_${group.index}`} defaultValue={group.suggestion ? String(group.suggestion.recipe_id) : ""} className="min-w-0 flex-1 rounded border border-line px-2 py-1.5"><option value="">Choose the complete recipe</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select><button name="apply_group" value={group.index} formNoValidate className="rounded bg-terracotta px-3 py-1.5 font-bold text-white">Confirm recipe</button></div>
        </>}
      </div>)}
      {pendingGroups.length > 0 && <button className="w-full rounded bg-cocoa px-3 py-2 font-bold text-white">Apply all assigned recipes</button>}
      <p className="text-[10px] text-warning">Applied assignments are durable. When all groups are applied, cancel this blocked preview and prepare a new one.</p>
    </OdooSaveForm>}
  </div>;
}

function ReplenishmentPlan({ run, warehouseNames }: { run: Run; warehouseNames: Map<number, string> }) {
  const replenishment = run.payload?.replenishment as Record<string, unknown> | undefined;
  if (!replenishment?.required) return null;
  const requirements = records(replenishment.requirements);
  const shortages = requirements.filter((requirement) => Number(requirement.transfer_quantity) > 0);
  return <div className="rounded-lg border border-terracotta/30 bg-terracotta/5 p-3">
    <h4 className="font-bold text-cocoa">Package-rounded stock replenishment</h4>
    <p className="mt-1 text-[11px] text-taupe">Snapshot {value(replenishment.observed_at)} · effective date {value(replenishment.effective_date)} · source {warehouseNames.get(Number(replenishment.source_warehouse_id)) ?? `Odoo warehouse ${value(replenishment.source_warehouse_id)}`}</p>
    <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[760px] text-[10px]">
      <thead className="text-left uppercase text-taupe"><tr><th className="py-1">Destination / product</th><th>Required</th><th>Available</th><th>Shortage</th><th>Transfer</th><th>Expected residual</th></tr></thead>
      <tbody className="divide-y divide-line">{requirements.map((requirement) => <tr key={`${value(requirement.destination_warehouse_id)}:${value(requirement.odoo_product_id)}`}>
        <td className="py-1.5 font-semibold text-cocoa">{warehouseNames.get(Number(requirement.destination_warehouse_id)) ?? value(requirement.destination_warehouse_id)} · {value(requirement.product_name)}</td>
        <td>{value(requirement.required_quantity)} {value(requirement.stock_uom)}</td><td>{value(requirement.available_quantity)}</td><td>{value(requirement.shortage_quantity)}</td><td className="font-bold text-terracotta">{value(requirement.transfer_quantity)}</td><td>{value(requirement.expected_residual_quantity)}</td>
      </tr>)}</tbody>
    </table></div>
    {run.status === "replenishment_planning" && <form action={confirmPlatformReplenishment} className="mt-3 space-y-3">
      <input type="hidden" name="export_id" value={run.id} />
      {shortages.filter((requirement) => String(requirement.tracking) !== "none").map((requirement) => <fieldset key={`${value(requirement.destination_warehouse_id)}:${value(requirement.odoo_product_id)}`} className="rounded border border-line bg-white p-2">
        <legend className="px-1 font-bold text-cocoa">Select whole source units for {value(requirement.product_name)} to {warehouseNames.get(Number(requirement.destination_warehouse_id)) ?? value(requirement.destination_warehouse_id)} · total {value(requirement.transfer_quantity)} {value(requirement.stock_uom)}</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">{records(requirement.lot_candidates).map((lot) => <label key={String(lot.odoo_lot_id)} className="rounded bg-cream px-2 py-1.5 text-taupe"><span className="block font-semibold text-cocoa">{value(lot.lot_name)} · {value(lot.available_quantity)} available</span><span className="text-[9px]">Expires {value(lot.expiration_date, "not recorded")}</span><input name={`lot_quantity:${value(requirement.destination_warehouse_id)}:${value(requirement.odoo_product_id)}:${value(lot.odoo_lot_id)}`} type="number" min="0" max={Number(lot.available_quantity)} step={Number(requirement.transfer_increment)} defaultValue="0" className="mt-1 w-full rounded border border-line px-2 py-1 text-cocoa" /></label>)}</div>
      </fieldset>)}
      <label className="flex items-start gap-2 text-[11px] font-semibold text-cocoa"><input type="checkbox" name="replenishment_acknowledgement" value="confirm_internal_transfers" required className="mt-0.5" />I reviewed the rounded transfer quantities, destinations, source lots, available stock, snapshot time, and historical document date. Create all internal transfers atomically in Odoo.</label>
      <RunSubmitButton idle="Confirm replenishment transfers" pending="Confirming replenishment..." className="rounded bg-terracotta px-3 py-2 text-xs font-bold text-white" />
    </form>}
    {run.status === "replenishment_failed" && <form action={retryPlatformReplenishment} className="mt-3 rounded border border-warning/40 bg-warning/10 p-2">
      <input type="hidden" name="export_id" value={run.id} />
      <label className="flex items-start gap-2 text-[11px] text-cocoa"><input type="checkbox" name="retry_acknowledgement" value="retry_same_transfers" required className="mt-0.5" />Retry the exact frozen destinations, quantities, and lots. I verified the failure cause has been corrected in Odoo.</label>
      <RunSubmitButton idle="Retry frozen replenishment" pending="Scheduling retry..." className="mt-2 rounded bg-warning px-3 py-2 text-xs font-bold text-white" />
    </form>}
  </div>;
}

function RunDetails({ run, displayTimeZone, recipes, warehouseNames }: { run: Run; displayTimeZone: string; recipes: { id: string; name: string }[]; warehouseNames: Map<number, string> }) {
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
              <p className="font-bold text-cocoa">Warehouse Odoo ID {value(warehouse.odoo_warehouse_id)} · Sales customer configured in Odoo</p>
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

        <ReplenishmentPlan run={run} warehouseNames={warehouseNames} />
        {run.blocked_items.length > 0 && <BlockedItems items={run.blocked_items} recipes={recipes} remediable={run.status === "blocked" && run.initiated_by === "platform"} exportId={run.id} />}
        {run.replenishment_result && <div><h4 className="font-bold text-cocoa">Odoo replenishment result</h4><pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded bg-cream p-2 text-[10px] text-cocoa">{JSON.stringify(run.replenishment_result, null, 2)}</pre></div>}
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
        {run.initiated_by === "platform" && (run.status === "draft" || run.status === "blocked" || run.status === "replenishment_planning") && (
          <form action={cancelPlatformPeriod} className="rounded-lg border border-line p-3">
            <input type="hidden" name="export_id" value={run.id} />
            <label className="flex items-start gap-2 text-[11px] text-cocoa"><input type="checkbox" name="cancel_acknowledgement" value="cancel_unconfirmed_preview" required className="mt-0.5" />{run.replenishment_result?.accepted === true ? "Cancel manufacturing and release its reserved orders. The completed Odoo internal transfers remain in place and are not reversed." : `${run.order_count ? "Cancel this unconfirmed preview and release its reserved orders." : "Remove this empty, unconfirmed preview."} Nothing will be sent to Odoo.`}</label>
            <RunSubmitButton idle={run.order_count ? "Cancel unconfirmed preview" : "Remove empty preview"} pending="Cancelling preview..." className="mt-2 rounded border border-line bg-white px-3 py-2 text-xs font-bold text-cocoa" />
          </form>
        )}
      </div>
    </details>
  );
}

export function ProductionRunsPanel({ runs, timeZone, recipes, warehouses }: { runs: Run[]; timeZone: string; recipes: { id: string; name: string }[]; warehouses: { odoo_id: number; name: string }[] }) {
  const warehouseNames = new Map(warehouses.map((warehouse) => [warehouse.odoo_id, warehouse.name]));
  const preparationActive = runs.some((run) => run.status === "preparing");
  return (
    <div className="rounded-xl border border-line p-4">
      <ManufacturingPreparationRefresh active={preparationActive} />
      <h3 className="text-sm font-bold text-cocoa">Manufacturing runs</h3>
      <p className="mt-1 text-[11px] text-taupe">Preparing calculates and freezes a reviewable payload. It does not release manufacturing work to Odoo.</p>
      <form action={preparePlatformPeriod} className="mt-3 grid grid-cols-2 gap-2">
        <input type="hidden" name="request_id" value={crypto.randomUUID()} />
        <label className="text-xs text-taupe"><span className="mb-1 block">From date (included)</span><input name="date_from" type="date" required className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <label className="text-xs text-taupe"><span className="mb-1 block">Through date (included)</span><input name="date_to" type="date" required className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <label className="col-span-2 text-xs text-taupe"><span className="mb-1 block">IANA timezone</span><input name="time_zone" required defaultValue={timeZone} className="w-full rounded border border-line px-2 py-1.5 text-cocoa" /></label>
        <RunSubmitButton idle="Queue frozen preview" pending="Queueing preview..." className="col-span-2 rounded bg-terracotta px-3 py-2 text-xs font-bold text-white" />
        <p className="col-span-2 text-[11px] text-taupe">Preparation continues in the background. You can leave this page; the run will create an alert when it is ready or fails.</p>
      </form>
      <div className="mt-4 max-h-[36rem] space-y-3 overflow-auto">{runs.map((run) => (
        <div id={`run-${run.id}`} key={run.id} className="scroll-mt-4 rounded-lg bg-cream/60 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all font-mono font-semibold text-cocoa">{run.idempotency_key}</span><span className="font-bold uppercase text-taupe">{run.status === "preparing" && run.preparation_stage ? run.preparation_stage : run.status} · {run.initiated_by}</span></div>
          <p className="mt-1 font-semibold text-cocoa">{run.status === "blocked" && !run.order_count && run.blocked_items.length > 0 && run.blocked_items.every((item) => item.problem_code === "already_in_production_run") ? "This duplicate reserved no orders and sent nothing to Odoo. It can be removed safely." : STATUS_COPY[run.status] ?? "Review this run before taking another action."}</p>
          {run.preparation_error && <p className="mt-1 text-warning">{run.preparation_error}</p>}
          <p className="mt-1 text-taupe">{formatDateTime(run.period_from, run.time_zone)} to {formatDateTime(run.period_to, run.time_zone)} ({run.time_zone}, end exclusive) · {run.order_count} reserved order rows{run.blocked_items.length ? ` · ${run.blocked_items.length} blocker findings` : ""}</p>
          <RunDetails run={run} displayTimeZone={timeZone} recipes={recipes} warehouseNames={warehouseNames} />
        </div>
      ))}{!runs.length && <p className="text-sm text-taupe">No manufacturing runs prepared.</p>}</div>
    </div>
  );
}
