"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { canAccessMachine } from "@/lib/data/service-access";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { authorizedActionReport } from "@/lib/data/action-report-access";
import { actionReportExtractionSchema } from "@/lib/action-report-ai-schema";
import { captureActionReportStockSnapshot } from "@/lib/action-report-stock";
import { legacyKindFromModes, modesFromLegacyKind, parseActionReportModes } from "@/lib/action-report-modes";

export type ActionReportResult = {
  ok: boolean;
  error?: string;
  warning?: string;
  reportId?: string;
  revision?: number;
  status?: "draft" | "confirmed";
  provenanceStatus?: string;
  stockSnapshotStatus?: "captured" | "needs_review" | "failed";
};

type ReportSource = "web" | "machine_qr";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function submitActionReport(source: ReportSource, _previous: ActionReportResult | null, formData: FormData): Promise<ActionReportResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Service is not configured." };
  const actor = await getSessionProfile();
  if (!actor) return { ok: false, error: "Sign in again before recording this action." };

  const clientUuid = String(formData.get("client_uuid") ?? "");
  const machineId = String(formData.get("machine_id") ?? "");
  const occurredAt = String(formData.get("occurred_at") ?? "");
  const expectedRevision = Number(formData.get("expected_revision") ?? 0);
  const actionModes = parseActionReportModes(formData.getAll("action_modes").map(String));
  const intent = String(formData.get("intent") ?? "confirmed");
  const status = intent === "draft" ? "draft" : "confirmed";
  const occurredMs = Date.parse(occurredAt);
  if (!UUID.test(clientUuid) || !UUID.test(machineId) || !Number.isFinite(occurredMs) || occurredMs < Date.parse("2020-01-01") || occurredMs > Date.now() + 5 * 60_000) {
    return { ok: false, error: "Choose a valid machine and action time." };
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) return { ok: false, error: "This draft has an invalid revision." };
  if (!actionModes) return { ok: false, error: "Choose at least one valid action type." };
  const actionKind = legacyKindFromModes(actionModes);
  const incidentIds = [...new Set(formData.getAll("incident_ids").map(String))];
  if (incidentIds.length > 20 || incidentIds.some((id) => !UUID.test(id))) return { ok: false, error: "Choose valid incidents for this machine." };

  const hasCleaning = actionModes.includes("cleaning");
  const hasRefill = actionModes.includes("refill");
  const hasOther = actionModes.includes("other");
  const materialValue = String(formData.get("cleaning_material_used") ?? "");
  const bucketValue = String(formData.get("water_bucket_count") ?? "");
  const waterBucketCount = bucketValue === "" ? null : Number(bucketValue);
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 5000);
  if (status === "confirmed" && hasCleaning && !["yes", "no"].includes(materialValue)) return { ok: false, error: "Confirm whether cleaning material was used." };
  if (status === "confirmed" && hasCleaning && (!Number.isInteger(waterBucketCount) || waterBucketCount === null || waterBucketCount < 0 || waterBucketCount > 20)) {
    return { ok: false, error: "Water buckets must be a whole number from 0 to 20." };
  }
  if (status === "confirmed" && hasOther && !notes) return { ok: false, error: "Describe the other action in notes." };

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
    const { data: existingOwnedReport, error: ownershipError } = await s.from("service_action_reports").select("id,operator_id,status,revision").eq("client_uuid", clientUuid).maybeSingle();
    if (ownershipError) throw ownershipError;
    if (existingOwnedReport && actor.role !== "admin" && existingOwnedReport.operator_id !== actor.id) return { ok: false, error: "You do not own this draft." };
    if (status === "confirmed") {
      const { data: existingReport } = await s.from("service_action_reports").select("id").eq("client_uuid", clientUuid).maybeSingle();
      if (existingReport) {
        const { data: aiJobs, error: aiError } = await s.from("service_action_ai_jobs").select("id,status,reviewed_at").eq("report_id", existingReport.id);
        if (aiError) throw aiError;
        const jobs = aiJobs ?? [];
        if (jobs.some((job) => job.status === "processing" && !job.reviewed_at)) return { ok: false, error: "Voice AI processing is active. Wait for it to finish before confirming." };
        const unreviewed = jobs.filter((job) => !job.reviewed_at && ["queued", "retry_wait", "complete"].includes(job.status));
        if (unreviewed.length && String(formData.get("ignore_ai") ?? "") !== "yes") return { ok: false, error: "Review the voice AI suggestions or choose to continue manually before confirming." };
        if (unreviewed.length) {
          const now = new Date().toISOString();
          const { error: reviewError } = await s.from("service_action_ai_jobs").update({ reviewed_by: actor.id, reviewed_at: now, status: "failed", last_error: "Discarded in favor of manual review" }).in("id", unreviewed.filter((job) => job.status !== "complete").map((job) => job.id));
          if (reviewError) throw reviewError;
          const completeIds = unreviewed.filter((job) => job.status === "complete").map((job) => job.id);
          if (completeIds.length) {
            const { error: completeReviewError } = await s.from("service_action_ai_jobs").update({ reviewed_by: actor.id, reviewed_at: now }).in("id", completeIds);
            if (completeReviewError) throw completeReviewError;
          }
          await s.from("service_action_questions").update({ status: "dismissed" }).eq("report_id", existingReport.id).eq("status", "open");
        }
      }
    }
    const occurredAtIso = new Date(occurredMs).toISOString();
    const operatorId = existingOwnedReport?.operator_id ?? actor.id;
    const draftPayload = {
      client_uuid: clientUuid,
      machine_id: machineId,
      occurred_at: occurredAtIso,
      status,
      action_kind: actionKind,
      action_modes: actionModes,
      notes: notes || null,
      cleaning: {
        material_used: hasCleaning && materialValue ? materialValue === "yes" : null,
        water_buckets: hasCleaning ? waterBucketCount : null,
      },
      refill_lines: refillLines,
    };
    const reportArgs = {
      p_client_uuid: clientUuid,
      p_machine_id: machineId,
      p_operator_id: operatorId,
      p_actor_id: actor.id,
      p_occurred_at: occurredAtIso,
      p_status: status,
      p_notes: notes || null,
      p_cleaning_material_used: hasCleaning && materialValue ? materialValue === "yes" : null,
      p_water_bucket_count: hasCleaning ? waterBucketCount : null,
      p_refill_lines: refillLines,
      p_source: source,
      p_action_modes: actionModes,
      p_expected_revision: expectedRevision,
      p_draft_payload: draftPayload,
      p_incident_ids: incidentIds,
    };
    const { data, error } = await s.rpc("record_revisioned_service_action_report", reportArgs);
    if (error) return { ok: false, error: error.message };

    const result = data as { id: string; status: "draft" | "confirmed"; revision: number; provenance_status: string; projection_error?: string | null };
    const warnings: string[] = result.projection_error ? ["The physical report was saved, but a legacy projection needs review."] : [];
    let stockSnapshotStatus: ActionReportResult["stockSnapshotStatus"];
    if (result.status === "confirmed" && hasRefill) {
      try {
        stockSnapshotStatus = (await captureActionReportStockSnapshot(s, result.id, actor.id)).status;
      } catch (snapshotError) {
        console.error("[action-report-stock-snapshot]", snapshotError);
        stockSnapshotStatus = "failed";
        warnings.push("The report was saved, but the Huaxin menu stock observation could not be captured. Retry it from this page.");
      }
    }

    revalidatePath("/refills");
    revalidatePath("/lot-audit");
    revalidatePath("/incidents");
    revalidatePath("/machines");
    revalidatePath("/alerts");
    revalidatePath(`/machine/${machineId}`);
    return {
      ok: true,
      reportId: result.id,
      revision: result.revision,
      status: result.status,
      provenanceStatus: result.provenance_status,
      stockSnapshotStatus,
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

export async function applyActionReportAiProposal(_previous: ActionReportResult | null, formData: FormData): Promise<ActionReportResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: "Service is not configured." };
  const actor = await getSessionProfile();
  if (!actor) return { ok: false, error: "Sign in again." };
  const reportId = String(formData.get("report_id") ?? "");
  const jobId = String(formData.get("job_id") ?? "");
  if (!UUID.test(reportId) || !UUID.test(jobId)) return { ok: false, error: "Invalid AI review." };
  try {
    const s = await createServiceClient();
    const report = await authorizedActionReport(s, actor, reportId, true);
    if (!report) return { ok: false, error: "Draft not found." };
    const [{ data: job, error: jobError }, { data: currentLines, error: lineError }, { data: incidentLinks, error: incidentError }] = await Promise.all([
      s.from("service_action_ai_jobs").select("id,status,extraction").eq("id", jobId).eq("report_id", reportId).maybeSingle(),
      s.from("service_action_refill_lines").select("quantity,unit,product_name,observed_lot_code,observed_odoo_lot_id,line_number").eq("report_id", reportId).order("line_number"),
      s.from("service_action_report_incidents").select("incident_id").eq("report_id", reportId),
    ]);
    if (jobError) throw jobError;
    if (lineError) throw lineError;
    if (incidentError) throw incidentError;
    if (!job || job.status !== "complete") return { ok: false, error: "AI extraction is not ready." };
    const extraction = actionReportExtractionSchema.parse(job.extraction);
    let refillLines = ((currentLines as Record<string, unknown>[]) ?? []).map((line) => ({ quantity: Number(line.quantity), unit: line.unit, product_name: line.product_name, lot_code: line.observed_lot_code, odoo_lot_id: line.observed_odoo_lot_id }));
    if (extraction.refillLines.length && refillLines.length === 0) {
      refillLines = extraction.refillLines.flatMap((line) => {
        if (!line.quantity) return [];
        return [{ quantity: line.quantity, unit: line.unit ?? "unit", product_name: line.productName, lot_code: line.observedLotCode, odoo_lot_id: null }];
      });
    }
    const currentModes = parseActionReportModes(report.action_modes, report.action_kind) ?? modesFromLegacyKind(report.action_kind);
    const proposedModes = modesFromLegacyKind(extraction.actionKind);
    const actionModes = parseActionReportModes([...new Set([...currentModes, ...proposedModes, ...(extraction.otherActions.length ? ["other" as const] : [])])]) ?? currentModes;
    const actionKind = legacyKindFromModes(actionModes);
    const hasCleaning = actionModes.includes("cleaning");
    const aiNotes = [extraction.notes, ...extraction.otherActions].filter(Boolean).join("\n");
    const notes = [report.notes, aiNotes].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join("\n") || null;
    const draftPayload = {
      client_uuid: report.client_uuid,
      machine_id: report.machine_id,
      occurred_at: report.occurred_at,
      status: "draft",
      action_kind: actionKind,
      action_modes: actionModes,
      notes,
      cleaning: {
        material_used: hasCleaning ? report.cleaning_material_used ?? extraction.cleaning.materialUsed : null,
        water_buckets: hasCleaning ? report.water_bucket_count ?? extraction.cleaning.waterBucketCount : null,
      },
      refill_lines: actionModes.includes("refill") ? refillLines : [],
    };
    const { error } = await s.rpc("record_revisioned_service_action_report", {
      p_client_uuid: report.client_uuid,
      p_machine_id: report.machine_id,
      p_operator_id: report.operator_id,
      p_actor_id: actor.id,
      p_occurred_at: report.occurred_at,
      p_status: "draft",
      p_notes: notes,
      p_cleaning_material_used: hasCleaning ? report.cleaning_material_used ?? extraction.cleaning.materialUsed : null,
      p_water_bucket_count: hasCleaning ? report.water_bucket_count ?? extraction.cleaning.waterBucketCount : null,
      p_refill_lines: actionModes.includes("refill") ? refillLines : [],
      p_source: report.source,
      p_action_modes: actionModes,
      p_expected_revision: report.revision,
      p_draft_payload: draftPayload,
      p_incident_ids: (incidentLinks ?? []).map((link) => link.incident_id),
    });
    if (error) throw error;
    const { count: openQuestions, error: questionError } = await s.from("service_action_questions").select("id", { count: "exact", head: true }).eq("ai_job_id", jobId).eq("status", "open");
    if (questionError) throw questionError;
    if (!openQuestions) {
      const { error: reviewError } = await s.from("service_action_ai_jobs").update({ reviewed_by: actor.id, reviewed_at: new Date().toISOString() }).eq("id", jobId);
      if (reviewError) throw reviewError;
    }
    revalidatePath("/refills");
    revalidatePath(`/machine/${report.machine_id}`);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  redirect(`/refills?draft=${reportId}#action-report-form`);
}
