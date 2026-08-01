"use client";

import { useActionState, useState } from "react";
import { createUser, type UserResult } from "./actions";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export function CreateUserForm({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [res, action, pending] = useActionState<UserResult | null, FormData>(createUser, null);
  const [mode, setMode] = useState<"password" | "invite">("invite");
  const [role, setRole] = useState("operator");
  const [employerKind, setEmployerKind] = useState("softlife");

  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
      <input type="hidden" name="creation_mode" value={mode} />
      <label className="block">
        <span className={label}>Full name</span>
        <input name="full_name" placeholder="Jane Operator" className={input} />
      </label>
      <label className="block">
        <span className={label}>Email *</span>
        <input name="email" type="email" required placeholder="jane@softlife.es" className={input} />
      </label>
      {mode === "password" ? (
        <label className="block">
          <span className={label}>Password *</span>
          <input name="password" type="password" required minLength={8} placeholder="At least 8 characters" className={input} />
        </label>
      ) : <div />}
      <label className="block">
        <span className={label}>Role</span>
        <select name="role" value={role} onChange={(event) => setRole(event.target.value)} className={input}>
          <option value="operator">Operator</option>
          <option value="franchisee">Franchisee</option>
          <option value="admin">Admin</option>
        </select>
      </label>
      <label className="block">
        <span className={label}>Employer type</span>
        <select name="employer_kind" value={employerKind} onChange={(event) => setEmployerKind(event.target.value)} className={input}>
          <option value="softlife">SoftLife</option>
          <option value="franchisee">Franchisee</option>
          <option value="contractor">Contractor</option>
        </select>
      </label>
      {employerKind !== "softlife" && <label className="block"><span className={label}>Employer account *</span><select name="tenant_id" required className={input} defaultValue=""><option value="" disabled>Select account</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
      <fieldset className="sm:col-span-4">
        <legend className={label}>Account setup</legend>
        <div className="flex flex-wrap gap-4 text-sm text-cocoa">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "invite"} onChange={() => setMode("invite")} />
            Email setup link
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "password"} onChange={() => setMode("password")} />
            Set password now
          </label>
        </div>
      </fieldset>
      <div className="flex items-center gap-3 sm:col-span-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {pending ? "Creating…" : mode === "invite" ? "Send invitation" : "Create user"}
        </button>
        {res && !res.ok && <span className="text-xs text-danger">{res.error}</span>}
        {res && res.ok && <span className="text-sm font-semibold text-sage">{res.message}</span>}
      </div>
    </form>
  );
}
