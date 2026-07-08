"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { createProduct, updateProduct, type ProductResult } from "./actions";
import { extractFromSheet, type ExtractResult } from "./extract";
import type { Allergen } from "@/lib/data/allergens";
import type { Product } from "@/lib/data/products";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";
const n = (v: number | null | undefined) => (v != null ? String(v) : "");

function Field({ labelText, children }: { labelText: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={label}>{labelText}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-cream/40 p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-taupe">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}

function AllergenGroup({
  allergens,
  name,
  title,
  selected,
}: {
  allergens: Allergen[];
  name: string;
  title: string;
  selected: string[];
}) {
  return (
    <div className="col-span-2 sm:col-span-3">
      <span className={label}>{title}</span>
      <div className="flex flex-wrap gap-2">
        {allergens.map((a) => (
          <label key={a.id} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-2 py-1 text-xs text-cocoa">
            <input type="checkbox" name={name} value={a.id} defaultChecked={selected.includes(a.id)} className="accent-terracotta" />
            {a.logo_url ? (
              <img src={a.logo_url} alt={a.name} className="h-4 w-4 object-contain" />
            ) : (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-sand text-[9px] font-bold text-taupe">{a.name[0]}</span>
            )}
            {a.name}
          </label>
        ))}
      </div>
    </div>
  );
}

export function ProductForm({ allergens, product }: { allergens: Allergen[]; product?: Product }) {
  const [createRes, createAction, createPending] = useActionState<ProductResult | null, FormData>(
    product ? updateProduct : createProduct,
    null,
  );
  const [extractRes, extractAction, extractPending] = useActionState<ExtractResult | null, FormData>(extractFromSheet, null);
  const [ex, setEx] = useState<ExtractResult | null>(null);
  const [version, setVersion] = useState(0);
  const containsIds = product?.allergens.contains.map((a) => a.id) ?? [];
  const mayContainIds = product?.allergens.may_contain.map((a) => a.id) ?? [];

  useEffect(() => {
    if (extractRes && !extractRes.error) {
      setEx(extractRes);
      setVersion((v) => v + 1);
    }
  }, [extractRes]);

  return (
    <div className="space-y-4">
      {/* Spec-sheet extraction */}
      <form action={extractAction} encType="multipart/form-data" className="rounded-xl border border-terracotta/30 bg-terracotta/5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className={label}>Extract from spec sheet (image or PDF)</span>
            <input name="sheet" type="file" accept="image/*,.pdf,application/pdf" className={`w-64 text-xs ${input}`} />
          </label>
          <button type="submit" disabled={extractPending} className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60">
            {extractPending ? "Reading…" : "Extract with AI"}
          </button>
          {extractRes?.error && <span className="text-xs text-danger">{extractRes.error}</span>}
          {ex && !extractRes?.error && (
            <span className="text-xs text-sage">
              Filled from sheet{ex.unmatched.length ? ` · unmatched allergens: ${ex.unmatched.join(", ")}` : ""} — review &amp; edit.
            </span>
          )}
        </div>
      </form>

      {/* Main form (remounts on extract to apply defaults) */}
      <form key={version} action={createAction} encType="multipart/form-data" className="space-y-4">
        {product && <input type="hidden" name="id" value={product.id} />}
        <Section title="Identity">
          <Field labelText="SKU / Item ID"><input name="sku" defaultValue={ex?.sku ?? product?.sku ?? ""} placeholder="SKU-001" className={`w-full ${input}`} /></Field>
          <Field labelText="Name *"><input name="name" required defaultValue={ex?.name ?? product?.name ?? ""} placeholder="Oreo Crumb" className={`w-full ${input}`} /></Field>
          <Field labelText="Brand"><input name="brand" defaultValue={ex?.brand ?? product?.brand ?? ""} placeholder="Brand" className={`w-full ${input}`} /></Field>
          <Field labelText="Type">
            <select name="type" defaultValue={ex?.type ?? product?.type ?? "topping"} className={`w-full ${input}`}>
              <option value="base">Base</option>
              <option value="topping">Topping (solid)</option>
              <option value="sauce">Sauce (liquid)</option>
            </select>
          </Field>
          <Field labelText="Description"><textarea name="description" rows={2} defaultValue={ex?.description ?? product?.description ?? ""} className={`w-full ${input}`} /></Field>
        </Section>

        <Section title="Composition &amp; allergens">
          <Field labelText="Ingredients (composition)">
            <textarea name="ingredients_list" rows={2} defaultValue={ex?.ingredients_list ?? product?.ingredients_list ?? ""} placeholder="sugar, cocoa, wheat flour…" className={`col-span-2 w-full ${input}`} />
          </Field>
          <Field labelText="Country of origin"><input name="country_of_origin" defaultValue={ex?.country_of_origin ?? product?.country_of_origin ?? ""} placeholder="Spain" className={`w-full ${input}`} /></Field>
          <AllergenGroup allergens={allergens} name="contains" title="Allergens — contains" selected={ex?.containsIds ?? containsIds} />
          <AllergenGroup allergens={allergens} name="may_contain" title="Allergens — may contain" selected={ex?.mayContainIds ?? mayContainIds} />
        </Section>

        <Section title="Nutrition (per 100g)">
          <Field labelText="Nutritional claim"><input name="nutritional_claim" defaultValue={ex?.nutritional_claim ?? product?.nutritional_claim ?? ""} placeholder="High protein" className={`w-full ${input}`} /></Field>
          <Field labelText="Calories (kcal)"><input name="nf_calories" type="number" step="0.1" defaultValue={n(ex?.nf_calories ?? product?.nf_calories)} className={`w-full ${input}`} /></Field>
          <Field labelText="Protein (g)"><input name="nf_protein" type="number" step="0.1" defaultValue={n(ex?.nf_protein ?? product?.nf_protein)} className={`w-full ${input}`} /></Field>
          <Field labelText="Carbs (g)"><input name="nf_carbs" type="number" step="0.1" defaultValue={n(ex?.nf_carbs ?? product?.nf_carbs)} className={`w-full ${input}`} /></Field>
          <Field labelText="Sugar (g)"><input name="nf_sugar" type="number" step="0.1" defaultValue={n(ex?.nf_sugar ?? product?.nf_sugar)} className={`w-full ${input}`} /></Field>
          <Field labelText="Fat (g)"><input name="nf_fat" type="number" step="0.1" defaultValue={n(ex?.nf_fat ?? product?.nf_fat)} className={`w-full ${input}`} /></Field>
        </Section>

        <Section title="Commercial">
          <Field labelText="Sale price (€)"><input name="price" type="number" step="0.01" min="0" defaultValue={String(ex?.price ?? product?.price ?? 0)} className={`w-full ${input}`} /></Field>
          <Field labelText="Cost / kg (€)"><input name="cost_per_kg" type="number" step="0.01" defaultValue={n(ex?.cost_per_kg ?? product?.cost_per_kg)} className={`w-full ${input}`} /></Field>
          <Field labelText="Default portion size (g)"><input name="default_portion_size" type="number" step="0.1" defaultValue={n(ex?.default_portion_size ?? product?.default_portion_size)} className={`w-full ${input}`} /></Field>
        </Section>

      <Section title="Product image">
        <Field labelText="Product image">
          {product?.image_url && <img src={product.image_url} alt="" className="mb-2 h-12 w-12 rounded-lg object-cover" />}
          <input name="image" type="file" accept="image/*" className={`w-full text-xs ${input}`} />
          {product?.image_url && <span className="mt-1 block text-[10px] text-taupe">Leave blank to keep the current image.</span>}
        </Field>
      </Section>

        <div className="flex items-center gap-4">
          <button type="submit" disabled={createPending} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60">
            {createPending ? "Saving…" : product ? "Save changes" : "Add ingredient"}
          </button>
          {createRes && !createRes.ok && <span className="text-xs text-danger">{createRes.error}</span>}
          {createRes && createRes.ok && <span className="text-sm font-semibold text-sage">Saved.</span>}
        </div>
      </form>
    </div>
  );
}
