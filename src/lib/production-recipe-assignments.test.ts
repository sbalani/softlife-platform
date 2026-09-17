import assert from "node:assert/strict";
import test from "node:test";
import { parseProductionRecipeAssignments } from "./production-recipe-assignments.ts";

const exportId = "11111111-1111-4111-8111-111111111111";
const recipeA = "22222222-2222-4222-8222-222222222222";
const recipeB = "33333333-3333-4333-8333-333333333333";
const orderA = "44444444-4444-4444-8444-444444444444";
const orderB = "55555555-5555-4555-8555-555555555555";

test("bulk resolution includes every group with an assigned recipe", () => {
  const fd = new FormData();
  fd.set("export_id", exportId);
  fd.append("assignment_index", "0");
  fd.append("assignment_index", "1");
  fd.set("recipe_id_0", recipeA);
  fd.set("recipe_id_1", recipeB);
  fd.append("order_id_0", orderA);
  fd.append("order_id_1", orderB);

  assert.deepEqual(parseProductionRecipeAssignments(fd), {
    exportId,
    assignments: [
      { recipe_id: recipeA, order_ids: [orderA] },
      { recipe_id: recipeB, order_ids: [orderB] },
    ],
    totalOrders: 2,
  });
});

test("per-group resolution ignores selections from other groups", () => {
  const fd = new FormData();
  fd.set("export_id", exportId);
  fd.append("assignment_index", "0");
  fd.append("assignment_index", "1");
  fd.set("recipe_id_0", recipeA);
  fd.set("recipe_id_1", recipeB);
  fd.append("order_id_0", orderA);
  fd.append("order_id_1", orderB);
  fd.set("apply_group", "1");

  assert.deepEqual(parseProductionRecipeAssignments(fd).assignments, [
    { recipe_id: recipeB, order_ids: [orderB] },
  ]);
});

test("bulk resolution requires at least one selected recipe", () => {
  const fd = new FormData();
  fd.set("export_id", exportId);
  fd.append("assignment_index", "0");
  fd.append("order_id_0", orderA);

  assert.throws(() => parseProductionRecipeAssignments(fd), /Choose at least one complete recipe/);
});
