"use client";

import { useActionState } from "react";
import { createTenant, type TenantResult } from "./actions";

export function TenantForm() {
  const [res, action, pending] = useActionState<TenantResult | null, FormData>(createTenant, null);

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Name</span>
        <input
          name="name"
          required
          placeholder="e.g. Cafetería Centro"
          className="w-60 rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Kind</span>
        <select name="kind" className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa">
          <option value="franchisee">Franchisee</option>
          <option value="internal">Internal</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {res && !res.ok && <span className="text-xs text-danger">{res.error}</span>}
    </form>
  );
}
