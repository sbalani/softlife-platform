"use client";

import { useActionState, useState, useTransition } from "react";
import type { Tenant } from "@/lib/data/franchisees";
import type { FranchiseeAssignment } from "@/lib/data/franchisee-profit";
import { addFranchiseeAssignment, removeFranchiseeAssignment, type AssignmentResult } from "./assignment-actions";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export function FranchiseeAssignmentForm({ machineId, imei, tenants, assignments }: { machineId: string; imei: string; tenants: Tenant[]; assignments: FranchiseeAssignment[] }) {
  const [model, setModel] = useState("customer_service");
  const [result, action, pending] = useActionState<AssignmentResult | null, FormData>(addFranchiseeAssignment, null);
  const [removing, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <input type="hidden" name="machine_id" value={machineId} />
        <input type="hidden" name="imei" value={imei} />
        <label><span className={label}>Franchisee</span><select name="tenant_id" required className={input}><option value="">Select…</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>
        <label><span className={label}>Start date</span><input name="start_date" type="date" required className={input} /></label>
        <label><span className={label}>End date</span><input name="end_date" type="date" className={input} /><span className="text-[10px] text-taupe">Blank = ongoing</span></label>
        <label><span className={label}>Profit share</span><select name="service_model" value={model} onChange={(e) => setModel(e.target.value)} className={input}><option value="customer_service">26% · customer cleans/refills</option><option value="softlife_service">18% · SoftLife cleans/refills</option><option value="custom">Other</option></select></label>
        {model === "custom" && <label><span className={label}>Custom %</span><input name="custom_percent" type="number" min="0" max="100" step="0.01" required className={input} /></label>}
        <div className="flex items-end"><button disabled={pending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{pending ? "Saving…" : "Add assignment"}</button></div>
        {result && <p className={`sm:col-span-2 lg:col-span-5 text-xs ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? "Assignment added." : result.error}</p>}
      </form>

      {assignments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-xs"><thead className="text-left uppercase text-taupe"><tr><th className="py-2">Franchisee</th><th>Period</th><th>Service</th><th>Share</th><th /></tr></thead><tbody className="divide-y divide-line">{assignments.map((assignment) => <tr key={assignment.id}><td className="py-2 font-semibold text-cocoa">{assignment.tenant_name}</td><td>{assignment.start_date} → {assignment.end_date ?? "Ongoing"}</td><td>{assignment.service_model === "customer_service" ? "Customer cleans/refills" : assignment.service_model === "softlife_service" ? "SoftLife cleans/refills" : "Custom"}</td><td>{assignment.share_percent}%</td><td className="text-right"><button disabled={removing} onClick={() => confirm("Remove this assignment?") && startTransition(async () => { await removeFranchiseeAssignment(assignment.id, machineId, imei); })} className="font-semibold text-danger disabled:opacity-50">Remove</button></td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}
