"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { canAccessMachine } from "@/lib/data/service-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type ActionReportResult = {
  ok: boolean;
  error?: string;
  warning?: string;
  reportId?: string;
  status?: "draft" | "confirmed";
  provenanceStatus?: string;
};

type ReportSource = "web" | "machine_qr";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

async function submitActionReport(source: ReportSource, _previous: ActionReportResult | null, formData: FormData): Promise<ActionReportResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Service is not configured." };
  const actor = await getSessionProfile();
  if (!actor) return { ok: false, error: "Sign in again before recording this action." };

  const clientUuid = String(formData.get("client_uuid") ?? "");
  const machineId = String(formData.get("machine_id") ?? "");
  const occurredAt = String(formData.get("occurred_at") ?? "");
  const actionKind = String(formData.get("action_kind") ?? "");
  const intent = String(formData.get("intent") ?? "confirmed");
  const status = intent === "draft" ? "draft" : "confirmed";
  const occurredMs = Date.parse(occurredAt);
  if (!UUID.test(clientUuid) || !UUID.test(machineId) || !Number.isFinite(occurredMs) || occurredMs < Date.parse("2020-01-01") || occurredMs > Date.now() + 5 * 60_000) {
    return { ok: false, error: "Choose a valid machine and action time." };
  }
  if (!["cleaning", "refill", "both", "other"].includes(actionKind)) return { ok: false, error: "Choose an action type." };

  const hasCleaning = actionKind === "cleaning" || actionKind === "both";
  const hasRefill = actionKind === "refill" || actionKind === "both";
  const materialValue = String(formData.get("cleaning_material_used") ?? "");
  const bucketValue = String(formData.get("water_bucket_count") ?? "");
  const waterBucketCount = bucketValue === "" ? null : Number(bucketValue);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 5000);
  if (status === "confirmed" && hasCleaning && !["yes", "no"].includes(materialValue)) return { ok: false, error: "Confirm whether cleaning material was used." };
  if (status === "confirmed" && hasCleaning && (!Number.isInteger(waterBucketCount) || waterBucketCount === null || waterBucketCount < 0 || waterBucketCount > 20)) {
    return { ok: false, error: "Water buckets must be a whole number from 0 to 20." };
  }
  if (status === "confirmed" && actionKind === "other" && !notes) return { ok: false, error: "Describe the action in notes." };

  const quantities = formData.getAll("quantity").map(String);
  const lotIds = formData.getAll("odoo_lot_id").map(String);
  const lotCodes = formData.getAll("lot_code").map(String);
  const productNames = formData.getAll("product_name").map(String);
  const units = formData.getAll("unit").map(String);
  if (quantities.length > 20) return { ok: false, error: "A report can contain at most 20 refill lines." };
  const refillLines = hasRefill ? quantities.map((rawQuantity, index) => {
    const quantity = Number(rawQuantity);
    const rawLotId = lotIds[index] ?? "";
    return {
      quantity,
      unit: (units[index] || "unit").trim().slice(0, 30),
      odoo_lot_id: /^\d+$/.test(rawLotId) ? Number(rawLotId) : null,
      lot_code: (lotCodes[index] || "").trim().slice(0, 200) || null,
      product_name: (productNames[index] || "").trim().slice(0, 200) || null,
    };
  }).filter((line) => status === "confirmed" || line.quantity > 0) : [];
  if (status === "confirmed" && hasRefill && refillLines.length === 0) return { ok: false, error: "Add at least one refill line." };
  if (refillLines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) return { ok: false, error: "Enter a positive quantity for every refill line." };

  try {
    const s = await createServiceClient();
    if (!await canAccessMachine(s, actor, machineId, new Date(occurredMs).toISOString())) return { ok: false, error: "You do not have access to this machine at the action time." };
    const { data, error } = await s.rpc("record_service_action_report", {
      p_client_uuid: clientUuid,
      p_machine_id: machineId,
      p_operator_id: actor.id,
      p_occurred_at: new Date(occurredMs).toISOString(),
      p_action_kind: actionKind,
      p_status: status,
      p_notes: notes || null,
      p_cleaning_material_used: hasCleaning && materialValue ? materialValue === "yes" : null,
      p_water_bucket_count: hasCleaning ? waterBucketCount : null,
      p_refill_lines: refillLines,
      p_source: source,
    });
    if (error) return { ok: false, error: error.message };

    const result = data as { id: string; status: "draft" | "confirmed"; provenance_status: string; projection_error?: string | null };
    const files = [
      ...formData.getAll("evidence_photo").map((file) => ({ file, lineIndex: null as number | null })),
      ...formData.getAll("line_photo").map((file, lineIndex) => ({ file, lineIndex })),
    ].filter((entry): entry is { file: File; lineIndex: number | null } => entry.file instanceof File && entry.file.size > 0);
    const warnings: string[] = result.projection_error ? ["The physical report was saved, but a legacy projection needs review."] : [];
    const accepted = result.status === "confirmed" ? files.filter(({ file }) => FILE_TYPES[file.type] && file.size <= 4 * 1024 * 1024) : [];
    if (result.status === "draft" && files.length) warnings.push("Photos are attached when the report is confirmed.");
    else if (accepted.length !== files.length) warnings.push("Some photos were skipped because their type or size is unsupported.");

    if (accepted.length) {
      const { data: lineRows } = await s.from("service_action_refill_lines").select("id,line_number").eq("report_id", result.id).order("line_number");
      const lineIds = new Map(((lineRows as { id: string; line_number: number }[]) ?? []).map((line) => [line.line_number - 1, line.id]));
      for (const { file, lineIndex } of accepted) {
        const bytes = await file.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const scope = lineIndex === null ? "report" : `line-${lineIndex + 1}`;
        const path = `${actor.tenant_id ?? "platform"}/${result.id}/${scope}-${hash}.${FILE_TYPES[file.type]}`;
        const { error: uploadError } = await s.storage.from("service-action-evidence").upload(path, bytes, { contentType: file.type, upsert: true });
        if (uploadError) { warnings.push("A photo could not be uploaded; the physical report is still saved."); continue; }
        const { error: metadataError } = await s.from("service_action_attachments").upsert({
          report_id: result.id,
          refill_line_id: lineIndex === null ? null : lineIds.get(lineIndex) ?? null,
          kind: "photo",
          storage_path: path,
          mime_type: file.type,
          size_bytes: file.size,
          created_by: actor.id,
        }, { onConflict: "storage_path", ignoreDuplicates: true });
        if (metadataError) {
          await s.storage.from("service-action-evidence").remove([path]);
          warnings.push("A photo could not be attached; the physical report is still saved.");
        }
      }
    }

    revalidatePath("/refills");
    revalidatePath("/lot-audit");
    revalidatePath(`/machine/${machineId}`);
    return {
      ok: true,
      reportId: result.id,
      status: result.status,
      provenanceStatus: result.provenance_status,
      warning: [...new Set(warnings)].join(" ") || undefined,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function submitWebActionReport(previous: ActionReportResult | null, formData: FormData) {
  return submitActionReport("web", previous, formData);
}

export async function submitQrActionReport(previous: ActionReportResult | null, formData: FormData) {
  return submitActionReport("machine_qr", previous, formData);
}
