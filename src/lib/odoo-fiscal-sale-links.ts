import { canonicalJson } from "./odoo-sync-contract.ts";

export type FiscalSaleLink = {
  platform_invoice_id: string;
  odoo_move_id: number;
  source_order_id: string;
  export_id: string;
  recipe_version_id: string;
  odoo_warehouse_id: number;
  odoo_sale_order_id: number;
  odoo_product_id: number;
  quantity: number;
};

export type FiscalSaleLinkPayload = {
  contract_version: 1;
  local_month: string;
  links: FiscalSaleLink[];
};

export function validateFiscalSaleLinkResult(payload: FiscalSaleLinkPayload, result: Record<string, unknown>) {
  if (result.accepted !== true) return;
  if (!Array.isArray(result.links) || result.links.length !== payload.links.length) throw new Error("Fiscal sale-link result coverage is invalid");
  const expected = new Map(payload.links.map((link) => [link.platform_invoice_id, link]));
  const seen = new Set<string>();
  for (const value of result.links) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Fiscal sale-link result row is invalid");
    const row = value as Record<string, unknown>;
    const id = String(row.platform_invoice_id ?? "");
    const source = expected.get(id);
    if (!source || seen.has(id)
      || row.odoo_move_id !== source.odoo_move_id
      || row.odoo_sale_order_id !== source.odoo_sale_order_id
      || row.linked !== true
      || !Number.isInteger(row.odoo_sale_order_line_id) || Number(row.odoo_sale_order_line_id) <= 0
      || !["to invoice", "invoiced", "no"].includes(String(row.sale_order_status))) {
      throw new Error("Fiscal sale-link result identity is invalid");
    }
    seen.add(id);
  }
  if (canonicalJson([...seen].sort()) !== canonicalJson([...expected.keys()].sort())) throw new Error("Fiscal sale-link result set is invalid");
}
