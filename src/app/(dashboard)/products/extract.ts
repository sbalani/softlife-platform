"use server";

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

const schema = z.object({
  name: z.string().nullable(),
  sku: z.string().nullable(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  type: z.enum(["base", "topping", "sauce"]).nullable(),
  ingredients_list: z.string().nullable(),
  country_of_origin: z.string().nullable(),
  nutritional_claim: z.string().nullable(),
  nf_calories: z.number().nullable(),
  nf_protein: z.number().nullable(),
  nf_carbs: z.number().nullable(),
  nf_sugar: z.number().nullable(),
  nf_fat: z.number().nullable(),
  default_portion_size: z.number().nullable(),
  cost_per_kg: z.number().nullable(),
  price: z.number().nullable(),
  allergens_contains: z.array(z.string()),
  allergens_may_contain: z.array(z.string()),
});

export type ExtractResult = {
  name: string | null;
  sku: string | null;
  brand: string | null;
  description: string | null;
  type: "base" | "topping" | "sauce" | null;
  ingredients_list: string | null;
  country_of_origin: string | null;
  nutritional_claim: string | null;
  nf_calories: number | null;
  nf_protein: number | null;
  nf_carbs: number | null;
  nf_sugar: number | null;
  nf_fat: number | null;
  default_portion_size: number | null;
  cost_per_kg: number | null;
  price: number | null;
  containsIds: string[];
  mayContainIds: string[];
  unmatched: string[];
  error?: string;
};

const EMPTY: ExtractResult = {
  name: null, sku: null, brand: null, description: null, type: null,
  ingredients_list: null, country_of_origin: null, nutritional_claim: null,
  nf_calories: null, nf_protein: null, nf_carbs: null, nf_sugar: null, nf_fat: null,
  default_portion_size: null, cost_per_kg: null, price: null,
  containsIds: [], mayContainIds: [], unmatched: [],
};

export async function extractFromSheet(_prev: ExtractResult | null, fd: FormData): Promise<ExtractResult> {
  const file = fd.get("sheet");
  if (!(file instanceof File) || !file.size) return { ...EMPTY, error: "Please choose an image." };

  try {
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const isImage = file.type.startsWith("image/");
    const contentPart = isImage
      ? { type: "image" as const, image: `data:${file.type || "image/jpeg"};base64,${base64}` }
      : { type: "file" as const, data: base64, mediaType: file.type || "application/pdf" };
    const { object } = await generateObject({
      model: openai("gpt-4o-mini"),
      schema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract product information from this spec sheet / packaging label. For allergens, use standard names: gluten, milk, eggs, soy, peanuts, tree nuts, fish, crustaceans, sesame, mustard, celery, sulphites, lupin, molluscs. Set fields you can't read to null. 'type' is base (ice cream/yoghurt base), topping (solid), or sauce (liquid). Nutrition is per 100g.",
            },
            contentPart,
          ],
        },
      ],
    });

    let containsIds: string[] = [];
    let mayContainIds: string[] = [];
    const unmatched: string[] = [];
    if (isSupabaseConfigured()) {
      const s = await createServiceClient();
      const { data: all } = await s.from("allergens").select("id,name,slug");
      const registry = (all as { id: string; name: string; slug: string }[]) ?? [];
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, "");
      const match = (label: string) => {
        const n = norm(label);
        return registry.find(
          (a) => norm(a.name) === n || norm(a.slug) === n || n.includes(norm(a.slug)) || norm(a.slug).includes(n),
        );
      };
      for (const label of object.allergens_contains) {
        const m = match(label);
        if (m) containsIds.push(m.id);
        else unmatched.push(label);
      }
      for (const label of object.allergens_may_contain) {
        const m = match(label);
        if (m) mayContainIds.push(m.id);
        else unmatched.push(label);
      }
    }

    return {
      name: object.name, sku: object.sku, brand: object.brand, description: object.description,
      type: object.type, ingredients_list: object.ingredients_list,
      country_of_origin: object.country_of_origin, nutritional_claim: object.nutritional_claim,
      nf_calories: object.nf_calories, nf_protein: object.nf_protein, nf_carbs: object.nf_carbs,
      nf_sugar: object.nf_sugar, nf_fat: object.nf_fat,
      default_portion_size: object.default_portion_size, cost_per_kg: object.cost_per_kg,
      price: object.price, containsIds, mayContainIds, unmatched,
    };
  } catch (e) {
    return { ...EMPTY, error: e instanceof Error ? e.message : String(e) };
  }
}
