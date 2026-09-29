import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { fiscalCsvCell } from "@/lib/odoo-fiscal-preflight";

export async function GET(request: Request) {
  const actor = await getSessionProfile();
  if (!actor || actor.role !== "admin") return new Response("Forbidden.", { status: 403 });
  const runId = new URL(request.url).searchParams.get("run") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) return new Response("Invalid run.", { status: 400 });
  const s = await createServiceClient();
  const { data: run, error: runError } = await s.from("fiscal_preflight_runs").select("id,currency,tax_rate").eq("id", runId).maybeSingle();
  if (runError) throw runError;
  if (!run) return new Response("Not found.", { status: 404 });
  const items: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await s.from("fiscal_preflight_items")
      .select("order_id,status,operation_at,operation_local_date,order_code,payment_reference,description,units,gross_cents,tax_base_cents,vat_cents,recipe_id,odoo_product_id,refund_required,refund_reference,findings,source_sha256")
      .eq("run_id", runId).order("operation_at").order("order_id").range(offset, offset + 999);
    if (error) throw error;
    items.push(...((data as Record<string, unknown>[]) ?? []));
    if (!data || data.length < 1000) break;
  }
  const columns = ["order_id", "status", "operation_at", "operation_local_date", "order_code", "payment_reference", "description", "units", "gross_cents", "tax_base_cents", "vat_cents", "recipe_id", "odoo_product_id", "refund_required", "refund_reference", "findings", "source_sha256"];
  const lines = [columns.map(fiscalCsvCell).join(","), ...items.map((item) => columns.map((column) => fiscalCsvCell(column === "findings" ? JSON.stringify(item[column]) : item[column])).join(","))];
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fiscal-preflight-${runId}.csv"`, "Cache-Control": "private, no-store" },
  });
}
