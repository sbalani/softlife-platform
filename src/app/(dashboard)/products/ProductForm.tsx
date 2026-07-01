"use client";

import { useActionState } from "react";
import { createProduct, type ProductResult } from "./actions";

export function ProductForm({ tenants }: { tenants: { id: string; name: string }[] }) {
  const [res, action, pending] = useActionState<ProductResult | null, FormData>(createProduct, null);

  if (tenants.length === 0) {
    return (
      <p className="text-sm text-taupe">
        Create a franchisee/customer first (under <span className="font-semibold">Franchisees</span>) before adding products.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Name</span>
        <input
          name="name"
          required
          placeholder="e.g. Base Vainilla"
          className="w-56 rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Type</span>
        <select name="type" className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa">
          <option value="base">Base</option>
          <option value="topping">Topping</option>
          <option value="sauce">Sauce</option>
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Belongs to</span>
        <select name="tenant_id" required className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa">
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
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
