"use client";

import { useActionState, useState, useTransition } from "react";
import type { Machine } from "@/lib/data/machines";
import type { ChangeAlertRule } from "@/lib/data/change-alert-rules";
import { deleteAlertRule, saveAlertRule, setAlertRuleEnabled, type AlertRuleResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

const PRODUCT_FIELDS = new Set(["price", "marketPrice", "stock"]);
const STATUS_OPTIONS: Record<string, [string, string][]> = {
  cup_empty: [["true", "Empty"], ["false", "Available"]],
  material_empty: [["true", "Out of product"], ["false", "Available"]],
  device_online: [["false", "Offline"], ["true", "Online"]],
};

function conditionLabel(rule: ChangeAlertRule) {
  if (rule.rule_type !== "status_equals") return `${rule.min_value ?? "-∞"} to ${rule.max_value ?? "∞"}`;
  return STATUS_OPTIONS[rule.field]?.find(([value]) => value === rule.target_value)?.[1] ?? rule.target_value;
}

export function AlertRuleManager({ rules, machines, products }: { rules: ChangeAlertRule[]; machines: Machine[]; products: { id: string; name: string }[] }) {
  const [result, action, pending] = useActionState<AlertRuleResult | null, FormData>(saveAlertRule, null);
  const [updating, startTransition] = useTransition();
  const [field, setField] = useState("price");
  const statusOptions = STATUS_OPTIONS[field];
  return (
    <section className="mb-6 rounded-2xl border border-line bg-white p-5">
      <h2 className="font-display text-lg font-bold text-cocoa">Change alert rules</h2>
      <p className="mb-4 text-xs text-taupe">Choose a metric, then independently scope it to a product, a machine, both, or neither. Rules are evaluated during machine sync and the scheduled monitor.</p>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label><span className={label}>Rule name</span><input name="name" required placeholder="Standard price range" className={`w-44 ${input}`} /></label>
        <label><span className={label}>Metric or status</span><select name="field" value={field} onChange={(event) => setField(event.target.value)} className={input}><option value="price">Product price</option><option value="marketPrice">Product market price</option><option value="stock">Machine product stock</option><option value="temperature">Temperature</option><option value="cup_empty">Cup status</option><option value="material_empty">Product/material status</option><option value="device_online">Machine connectivity</option></select></label>
        {PRODUCT_FIELDS.has(field) && <label><span className={label}>Product</span><select name="product_id" className={input}><option value="">All products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>}
        <label><span className={label}>Machine</span><select name="machine_id" className={input}><option value="">All machines</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
        {statusOptions ? <label><span className={label}>Alert when</span><select name="target_value" className={input}>{statusOptions.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label> : <><label><span className={label}>Minimum</span><input name="min_value" type="number" step="0.01" className={`w-24 ${input}`} /></label><label><span className={label}>Maximum</span><input name="max_value" type="number" step="0.01" className={`w-24 ${input}`} /></label></>}
        <label><span className={label}>Severity</span><select name="severity" defaultValue="warning" className={input}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
        <button disabled={pending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{pending ? "Saving..." : "Add rule"}</button>
        {result && <span className={`text-xs ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? "Rule added." : result.error}</span>}
      </form>
      {rules.length > 0 && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="text-left text-[11px] uppercase text-taupe"><tr><th className="py-2">Rule</th><th>Field</th><th>Product scope</th><th>Machine scope</th><th>Condition</th><th>Severity</th><th /></tr></thead><tbody className="divide-y divide-line">{rules.map((rule) => <tr key={rule.id} className={rule.enabled ? "" : "opacity-50"}><td className="py-2 font-semibold text-cocoa">{rule.name}</td><td>{rule.field.replaceAll("_", " ")}</td><td>{rule.product_name ?? "All products"}</td><td>{rule.machine_name ?? "All machines"}</td><td>{conditionLabel(rule)}</td><td className="capitalize">{rule.severity}</td><td className="space-x-3 text-right"><button disabled={updating} onClick={() => startTransition(() => setAlertRuleEnabled(rule.id, !rule.enabled))} className="font-semibold text-terracotta">{rule.enabled ? "Pause" : "Enable"}</button><button disabled={updating} onClick={() => confirm("Delete this alert rule?") && startTransition(() => deleteAlertRule(rule.id))} className="font-semibold text-danger">Delete</button></td></tr>)}</tbody></table></div>}
    </section>
  );
}
