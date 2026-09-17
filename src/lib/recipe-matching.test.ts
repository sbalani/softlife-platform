import assert from "node:assert/strict";
import test from "node:test";
import { rankRecipeMatches, uniqueExactRecipe } from "./recipe-matching.ts";

const candidates = [
  { id: "combo", name: "Chocolate + Fresa + Soft", componentIds: ["chocolate", "fresa", "soft"] },
  { id: "pair", name: "Fresa + Soft", componentIds: ["fresa", "soft"] },
  { id: "other", name: "Vanilla", componentIds: ["vanilla"] },
];

test("finds an order-independent exact component match", () => {
  const ranked = rankRecipeMatches(["soft", "chocolate", "fresa"], candidates);
  assert.deepEqual(uniqueExactRecipe(ranked), {
    recipe_id: "combo",
    recipe_name: "Chocolate + Fresa + Soft",
    confidence: 100,
    matched_components: 3,
    missing_components: 0,
    extra_components: 0,
    exact: true,
  });
});

test("ranks partial component matches without treating them as exact", () => {
  const ranked = rankRecipeMatches(["chocolate", "fresa"], candidates);
  assert.equal(ranked[0].recipe_id, "combo");
  assert.equal(ranked[0].confidence, 80);
  assert.equal(ranked[0].exact, false);
});

test("duplicate observed ingredients cannot produce an automatic match", () => {
  const ranked = rankRecipeMatches(["fresa", "soft", "soft"], candidates);
  assert.equal(ranked[0].recipe_id, "pair");
  assert.equal(ranked[0].confidence, 80);
  assert.equal(ranked[0].exact, false);
  assert.equal(ranked[0].extra_components, 1);
  assert.equal(uniqueExactRecipe(ranked), null);
});

test("ambiguous exact candidates require confirmation", () => {
  const ranked = rankRecipeMatches(["fresa", "soft"], [
    ...candidates,
    { id: "duplicate-pair", name: "Another pair", componentIds: ["soft", "fresa"] },
  ]);
  assert.equal(uniqueExactRecipe(ranked), null);
});
