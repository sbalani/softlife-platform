import { z } from "zod";

export const actionReportExtractionSchema = z.object({
  actionKind: z.enum(["cleaning", "refill", "both", "other"]).nullable(),
  notes: z.string().max(5000).nullable(),
  cleaning: z.object({ performed: z.boolean().nullable(), materialUsed: z.boolean().nullable(), waterBucketCount: z.number().int().min(0).max(20).nullable() }),
  refillLines: z.array(z.object({ quantity: z.number().positive().nullable(), unit: z.enum(["unit", "kg", "l", "bag", "box"]).nullable(), observedLotCode: z.string().max(200).nullable(), productName: z.string().max(200).nullable() })).max(20),
  otherActions: z.array(z.string().max(500)).max(20),
});

export type ActionReportExtraction = z.infer<typeof actionReportExtractionSchema>;
export type ActionReportQuestion = { key: string; question: string };

export function actionReportQuestions(extraction: ActionReportExtraction): ActionReportQuestion[] {
  const questions: ActionReportQuestion[] = [];
  if (!extraction.actionKind) questions.push({ key: "action_kind", question: "Was this cleaning, a refill, both, or another action?" });
  const hasCleaning = extraction.actionKind === "cleaning" || extraction.actionKind === "both" || extraction.cleaning.performed === true;
  if (hasCleaning && extraction.cleaning.materialUsed === null) questions.push({ key: "cleaning_material", question: "Was cleaning material used?" });
  if (hasCleaning && extraction.cleaning.waterBucketCount === null) questions.push({ key: "water_buckets", question: "How many water buckets were used?" });
  const hasRefill = extraction.actionKind === "refill" || extraction.actionKind === "both";
  if (hasRefill && extraction.refillLines.length === 0) questions.push({ key: "refill_lines", question: "What product and quantity were loaded?" });
  extraction.refillLines.forEach((line, index) => {
    if (line.quantity === null) questions.push({ key: `refill_${index}_quantity`, question: `What quantity was loaded on refill line ${index + 1}?` });
    if (line.unit === null) questions.push({ key: `refill_${index}_unit`, question: `What unit applies to refill line ${index + 1}?` });
    if (!line.observedLotCode) questions.push({ key: `refill_${index}_lot`, question: `What lot or batch code was observed on refill line ${index + 1}?` });
  });
  return questions;
}
