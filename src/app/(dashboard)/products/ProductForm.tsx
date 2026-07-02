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

  const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
  const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

  return (
    <form action={action} encType="multipart/form-data" className="flex flex-wrap items-end gap-3">
      <label className="block">
        <span className={label}>Name</span>
        <input name="name" required placeholder="e.g. Base Vainilla" className={`w-48 ${input}`} />
      </label>
      <label className="block">
        <span className={label}>Type</span>
        <select name="type" className={input}>
          <option value="base">Base</option>
          <option value="topping">Topping (solid)</option>
          <option value="sauce">Sauce (liquid)</option>
        </select>
      </label>
      <label className="block">
        <span className={label}>Price (€)</span>
        <input name="price" type="number" step="0.01" min="0" defaultValue="0" className={`w-24 ${input}`} />
      </label>
      <label className="block">
        <span className={label}>Belongs to</span>
        <select name="tenant_id" required className={input}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className={label}>Product image</span>
        <input name="image" type="file" accept="image/*" className={`w-52 text-xs ${input}`} />
      </label>
      <label className="block">
        <span className={label}>Allergen image</span>
        <input name="allergen" type="file" accept="image/*" className={`w-52 text-xs ${input}`} />
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
