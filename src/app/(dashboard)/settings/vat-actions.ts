"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export type VatResult = { ok: boolean; error?: string };

export async function saveVatRate(_previous: VatResult | null, formData: FormData): Promise<VatResult> {
  const session = await getSessionProfile();
  if (session?.role !== "admin") return { ok: false, error: "Admin access required." };
  const effectiveFrom = String(formData.get("effective_from") ?? "");
  const ratePercent = Number(formData.get("rate_percent"));
  if (!effectiveFrom) return { ok: false, error: "Effective date is required." };
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) return { ok: false, error: "VAT must be between 0 and 100%." };

  const service = await createServiceClient();
  const { error } = await service.from("vat_rates").upsert({ effective_from: effectiveFrom, rate_percent: ratePercent }, { onConflict: "effective_from" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings");
  revalidatePath("/analytics");
  return { ok: true };
}
