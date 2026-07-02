"use client";

import { useActionState } from "react";
import { createProduct, type ProductResult } from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

function Field({ name, labelText, children }: { name: string; labelText: string; children: React.ReactNode }) {
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

export function ProductForm() {
  const [res, action, pending] = useActionState<ProductResult | null, FormData>(createProduct, null);

  return (
    <form action={action} encType="multipart/form-data" className="space-y-4">
      <Section title="Identity">
        <Field name="sku" labelText="SKU / Item ID">
          <input name="sku" placeholder="SKU-001" className={`w-full ${input}`} />
        </Field>
        <Field name="name" labelText="Name *">
          <input name="name" required placeholder="Oreo Crumb" className={`w-full ${input}`} />
        </Field>
        <Field name="brand" labelText="Brand">
          <input name="brand" placeholder="Brand" className={`w-full ${input}`} />
        </Field>
        <Field name="type" labelText="Type">
          <select name="type" className={`w-full ${input}`}>
            <option value="base">Base</option>
            <option value="topping">Topping (solid)</option>
            <option value="sauce">Sauce (liquid)</option>
          </select>
        </Field>
        <Field name="description" labelText="Description">
          <textarea name="description" rows={2} className={`w-full ${input}`} />
        </Field>
      </Section>

      <Section title="Composition &amp; allergens">
        <Field name="ingredients_list" labelText="Ingredients (composition)">
          <textarea name="ingredients_list" rows={2} placeholder="sugar, cocoa, wheat flour…" className={`col-span-2 w-full ${input}`} />
        </Field>
        <Field name="allergens_contains" labelText="Allergens — contains (comma-separated)">
          <input name="allergens_contains" placeholder="gluten, milk, soy" className={`w-full ${input}`} />
        </Field>
        <Field name="allergens_may_contain" labelText="Allergens — may contain">
          <input name="allergens_may_contain" placeholder="nuts, peanuts" className={`w-full ${input}`} />
        </Field>
        <Field name="country_of_origin" labelText="Country of origin">
          <input name="country_of_origin" placeholder="Spain" className={`w-full ${input}`} />
        </Field>
      </Section>

      <Section title="Nutrition (per 100g)">
        <Field name="nutritional_claim" labelText="Nutritional claim">
          <input name="nutritional_claim" placeholder="High protein" className={`w-full ${input}`} />
        </Field>
        <Field name="nf_calories" labelText="Calories (kcal)">
          <input name="nf_calories" type="number" step="0.1" className={`w-full ${input}`} />
        </Field>
        <Field name="nf_protein" labelText="Protein (g)">
          <input name="nf_protein" type="number" step="0.1" className={`w-full ${input}`} />
        </Field>
        <Field name="nf_carbs" labelText="Carbs (g)">
          <input name="nf_carbs" type="number" step="0.1" className={`w-full ${input}`} />
        </Field>
        <Field name="nf_sugar" labelText="Sugar (g)">
          <input name="nf_sugar" type="number" step="0.1" className={`w-full ${input}`} />
        </Field>
        <Field name="nf_fat" labelText="Fat (g)">
          <input name="nf_fat" type="number" step="0.1" className={`w-full ${input}`} />
        </Field>
      </Section>

      <Section title="Commercial">
        <Field name="price" labelText="Sale price (€)">
          <input name="price" type="number" step="0.01" min="0" defaultValue="0" className={`w-full ${input}`} />
        </Field>
        <Field name="cost_per_kg" labelText="Cost / kg (€)">
          <input name="cost_per_kg" type="number" step="0.01" className={`w-full ${input}`} />
        </Field>
        <Field name="default_portion_size" labelText="Default portion size (g)">
          <input name="default_portion_size" type="number" step="0.1" className={`w-full ${input}`} />
        </Field>
      </Section>

      <Section title="Images">
        <Field name="image" labelText="Product image">
          <input name="image" type="file" accept="image/*" className={`w-full text-xs ${input}`} />
        </Field>
        <Field name="allergen" labelText="Allergen image (machine screen)">
          <input name="allergen" type="file" accept="image/*" className={`w-full text-xs ${input}`} />
        </Field>
      </Section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Add ingredient"}
        </button>
        {res && !res.ok && <span className="text-xs text-danger">{res.error}</span>}
        {res && res.ok && <span className="text-sm font-semibold text-sage">Saved.</span>}
      </div>
    </form>
  );
}
