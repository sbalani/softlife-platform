"use client";

import { useActionState, useTransition } from "react";
import type { Machine } from "@/lib/data/machines";
import type { ChangeAlertRule } from "@/lib/data/change-alert-rules";
import { deleteAlertRule, saveAlertRule, setAlertRuleEnabled, type AlertRuleResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export function AlertRuleManager({ rules, machines }: { rules: ChangeAlertRule[]; machines: Machine[] }) {
  const [result, action, pending] = useActionState<AlertRuleResult | null, FormData>(saveAlertRule, null);
  const [updating, startTransition] = useTransition();
  return (
    <section className="mb-6 rounded-2xl border border-line bg-white p-5">
      <h2 className="font-display text-lg font-bold text-cocoa">Change alert rules</h2>
      <p className="mb-4 text-xs text-taupe">Creates an alert whenever a logged numeric change falls outside the allowed range.</p>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <label><span className={label}>Rule name</span><input name="name" required placeholder="Standard price range" className={`w-44 ${input}`} /></label>
        <label><span className={label}>Field</span><select name="field" className={input}><option value="price">Price</option><option value="marketPrice">Market price</option><option value="stock">Stock</option></select></label>
        <label><span className={label}>Machine</span><select name="machine_id" className={input}><option value="">All machines and products</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
        <label><span className={label}>Minimum</span><input name="min_value" type="number" step="0.01" className={`w-24 ${input}`} /></label>
        <label><span className={label}>Maximum</span><input name="max_value" type="number" step="0.01" className={`w-24 ${input}`} /></label>
        <label><span className={label}>Severity</span><select name="severity" defaultValue="warning" className={input}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
        <button disabled={pending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{pending ? "Saving..." : "Add rule"}</button>
        {result && <span className={`text-xs ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? "Rule added." : result.error}</span>}
      </form>
      {rules.length > 0 && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="text-left text-[11px] uppercase text-taupe"><tr><th className="py-2">Rule</th><th>Field</th><th>Scope</th><th>Allowed range</th><th>Severity</th><th /></tr></thead><tbody className="divide-y divide-line">{rules.map((rule) => <tr key={rule.id} className={rule.enabled ? "" : "opacity-50"}><td className="py-2 font-semibold text-cocoa">{rule.name}</td><td>{rule.field}</td><td>{rule.machine_name ?? "All"}</td><td>{rule.min_value ?? "-∞"} to {rule.max_value ?? "∞"}</td><td className="capitalize">{rule.severity}</td><td className="space-x-3 text-right"><button disabled={updating} onClick={() => startTransition(() => setAlertRuleEnabled(rule.id, !rule.enabled))} className="font-semibold text-terracotta">{rule.enabled ? "Pause" : "Enable"}</button><button disabled={updating} onClick={() => confirm("Delete this alert rule?") && startTransition(() => deleteAlertRule(rule.id))} className="font-semibold text-danger">Delete</button></td></tr>)}</tbody></table></div>}
    </section>
  );
}
