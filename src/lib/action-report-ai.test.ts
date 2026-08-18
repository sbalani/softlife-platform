import assert from "node:assert/strict";
import test from "node:test";
import { actionReportQuestions } from "./action-report-ai-schema.ts";

test("ambiguous cleaning and refill extraction creates deterministic questions", () => {
  const questions = actionReportQuestions({ actionKind: "both", notes: null, cleaning: { performed: true, materialUsed: null, waterBucketCount: null }, refillLines: [{ quantity: null, unit: null, observedLotCode: null, productName: "Mix" }], otherActions: [] });
  assert.deepEqual(questions.map((question) => question.key), ["cleaning_material", "water_buckets", "refill_0_quantity", "refill_0_unit", "refill_0_lot"]);
});

test("complete explicit extraction creates no questions", () => {
  assert.deepEqual(actionReportQuestions({ actionKind: "refill", notes: null, cleaning: { performed: false, materialUsed: null, waterBucketCount: null }, refillLines: [{ quantity: 1, unit: "bag", observedLotCode: "LOT-1", productName: "Mix" }], otherActions: [] }), []);
});
