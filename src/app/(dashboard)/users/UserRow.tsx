"use client";

import { useState, useTransition } from "react";
import { deleteUser, setUserAccess, setUserMachines } from "./actions";

export type UserRole = "admin" | "operator" | "franchisee";
export type EmployerKind = "softlife" | "franchisee" | "contractor";
export type UserRowData = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  employer_kind: EmployerKind;
  tenant_id: string | null;
  assigned_machine_ids: string[];
  isSelf: boolean;
};

const input = "rounded border border-line bg-white px-2 py-1 text-xs text-cocoa";

export function UserRow({ user, tenants, machines }: { user: UserRowData; tenants: { id: string; name: string }[]; machines: { id: string; name: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>(user.role);
  const [employerKind, setEmployerKind] = useState<EmployerKind>(user.employer_kind);
  const [tenantId, setTenantId] = useState(user.tenant_id ?? "");
  const [machineIds, setMachineIds] = useState(user.assigned_machine_ids);

  const run = (work: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setError(null); setMessage(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) setMessage(success); else setError(result.error ?? "Failed");
    });
  };

  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-4 py-3 font-semibold text-cocoa">{user.full_name ?? "—"}</td>
      <td className="px-4 py-3 text-taupe">{user.email ?? "—"}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <select value={role} onChange={(event) => setRole(event.target.value as UserRole)} disabled={user.isSelf || pending} className={input}><option value="operator">Operator</option><option value="franchisee">Franchisee</option><option value="admin">Admin</option></select>
          <select value={employerKind} onChange={(event) => setEmployerKind(event.target.value as EmployerKind)} disabled={user.isSelf || pending} className={input}><option value="softlife">SoftLife</option><option value="franchisee">Franchisee</option><option value="contractor">Contractor</option></select>
          {employerKind !== "softlife" && <select value={tenantId} onChange={(event) => setTenantId(event.target.value)} disabled={user.isSelf || pending} className={input}><option value="">Select employer</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select>}
          {!user.isSelf && <button disabled={pending} onClick={() => run(() => setUserAccess(user.id, role, employerKind, employerKind === "softlife" ? null : tenantId || null), "Access saved." )} className="text-xs font-bold text-terracotta">Save access</button>}
        </div>
        {role === "operator" && !user.isSelf && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-cocoa">Assigned machines ({machineIds.length})</summary><div className="mt-2 grid max-h-44 gap-1 overflow-y-auto sm:grid-cols-2">{machines.map((machine) => <label key={machine.id} className="flex items-center gap-2 text-xs text-taupe"><input type="checkbox" checked={machineIds.includes(machine.id)} onChange={(event) => setMachineIds((current) => event.target.checked ? [...current, machine.id] : current.filter((id) => id !== machine.id))} />{machine.name}</label>)}</div><button disabled={pending} onClick={() => run(() => setUserMachines(user.id, machineIds), "Assignments saved.")} className="mt-2 text-xs font-bold text-terracotta">Save assignments</button></details>}
      </td>
      <td className="px-4 py-3 text-right">
        {user.isSelf ? <span className="text-xs text-taupe">You</span> : <button onClick={() => confirm(`Remove ${user.email ?? "this user"}? This can't be undone.`) && run(() => deleteUser(user.id), "Removed.")} disabled={pending} className="text-xs font-semibold text-danger">Remove</button>}
        {error && <div className="mt-1 text-[11px] text-danger">{error}</div>}
        {message && <div className="mt-1 text-[11px] text-sage">{message}</div>}
      </td>
    </tr>
  );
}
