import { createClient } from "@supabase/supabase-js";
import {
  alertStatusSignals,
  type HuaxinStatusRow,
  isCompleteHuaxinStatusPayload,
} from "../_shared/huaxin-status-signals.ts";
import {
  canonicalStatuses,
  type ShadowStatusRow,
  statusHash,
} from "./status.ts";

type Machine = {
  id: string;
  name: string;
  display_name: string | null;
  device_imei: string;
  deployed: boolean;
};
type Target = { machine_id: string; machines: Machine };
type WorkerConfig = {
  mode: "shadow" | "authoritative";
  target_scope: "targets" | "all_deployed";
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  {
    auth: { persistSession: false },
  },
);

async function authorized(request: Request) {
  const token = request.headers.get("x-shadow-token");
  if (!token || token.length < 32) return false;
  const { data, error } = await supabase.rpc(
    "verify_huaxin_status_shadow_token",
    { p_token: token },
  );
  return !error && data === true;
}

async function fetchHuaxinStatus(deviceImei: string) {
  const token = Deno.env.get("HUAXIN_STATUS_BRIDGE_TOKEN");
  if (!token) throw new Error("Huaxin status bridge is not configured");
  const response = await fetch(
    Deno.env.get("HUAXIN_STATUS_BRIDGE_URL") ??
      "https://platform.softlife.es/api/internal/huaxin-status",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-huaxin-status-token": token,
      },
      body: JSON.stringify({ device_imei: deviceImei }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => ({})) as {
    code?: number | string;
    msg?: string;
    data?: unknown;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      body.error ?? body.msg ??
        `Huaxin status bridge returned HTTP ${response.status}`,
    );
  }
  if (String(body.code) !== "200") {
    throw new Error(body.msg ?? "Huaxin rejected the status request");
  }
  if (!Array.isArray(body.data)) {
    throw new Error("Huaxin returned an invalid machine status payload");
  }
  return body.data as ShadowStatusRow[];
}

async function getTargets(config: WorkerConfig) {
  if (config.target_scope === "all_deployed") {
    const { data, error } = await supabase.from("machines")
      .select("id,name,display_name,device_imei,deployed")
      .eq("deployed", true).not("device_imei", "is", null).neq(
        "device_imei",
        "",
      ).order("name");
    if (error) throw error;
    return (data as Machine[]) ?? [];
  }

  const { data, error } = await supabase.from("huaxin_status_shadow_targets")
    .select(
      "machine_id,machines!inner(id,name,display_name,device_imei,deployed)",
    )
    .eq("enabled", true).eq("machines.deployed", true).order("created_at");
  if (error) throw error;
  return ((data as unknown as Target[]) ?? []).map((target) => target.machines);
}

async function forEachConcurrent<T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>,
) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await task(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

async function handler(request: Request) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  if (!await authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({})) as {
    trigger_source?: unknown;
  };
  const triggerSource = payload.trigger_source === "cron" ? "cron" : "manual";
  const { data: runId, error: runError } = await supabase.rpc(
    "claim_huaxin_status_shadow_run",
    { p_trigger_source: triggerSource },
  );
  if (runError) {
    return Response.json({ error: runError.message }, { status: 500 });
  }
  if (!runId) {
    return Response.json({
      error: "A Huaxin status shadow run is already active",
    }, { status: 409 });
  }

  let succeeded = 0;
  let failed = 0;
  try {
    const { data: configData, error: configError } = await supabase.from(
      "huaxin_status_worker_config",
    )
      .select("mode,target_scope").eq("singleton", true).single();
    if (configError) throw configError;
    const config = configData as WorkerConfig;
    const targets = await getTargets(config);
    if (!targets.length) {
      throw new Error("No eligible Huaxin status worker targets");
    }
    const { error: runConfigError } = await supabase.from(
      "huaxin_status_shadow_runs",
    )
      .update({ worker_mode: config.mode, target_scope: config.target_scope })
      .eq("id", runId);
    if (runConfigError) throw runConfigError;

    await forEachConcurrent(targets, 4, async (machine) => {
      const resultBase = {
        run_id: runId,
        machine_id: machine.id,
        machine_name: machine.display_name || machine.name,
        device_imei: machine.device_imei,
        transport: "vercel_bridge",
      };
      try {
        const statuses = await fetchHuaxinStatus(machine.device_imei);
        const fetchedAt = new Date().toISOString();
        const canonical = canonicalStatuses(statuses);
        if (!isCompleteHuaxinStatusPayload(canonical as HuaxinStatusRow[])) {
          throw new Error(
            "Huaxin returned an incomplete machine status payload",
          );
        }
        let writeAccepted: boolean | null = null;
        let writeReason: string | null = null;
        if (config.mode === "authoritative") {
          const { data: writeData, error: writeError } = await supabase.rpc(
            "ingest_huaxin_machine_status",
            {
              p_machine_id: machine.id,
              p_observed_at: fetchedAt,
              p_statuses: canonical,
              p_signals: alertStatusSignals(canonical as HuaxinStatusRow[]),
              p_writer: "supabase_status_worker",
            },
          );
          if (writeError) throw writeError;
          const write = (Array.isArray(writeData) ? writeData[0] : writeData) as
            | { accepted?: boolean; reason?: string }
            | null;
          writeAccepted = write?.accepted === true;
          writeReason = write?.reason ?? null;
          if (!writeAccepted && writeReason !== "stale") {
            throw new Error(
              `Status write was rejected: ${writeReason ?? "unknown reason"}`,
            );
          }
        }
        const { data: current, error: currentError } = await supabase.from(
          "machine_status_snapshots",
        )
          .select("raw,observed_at").eq("machine_id", machine.id).like(
            "field",
            "raw:%",
          );
        if (currentError) throw currentError;
        const currentRows = ((current as {
          raw: ShadowStatusRow | null;
          observed_at: string;
        }[]) ?? []).flatMap((row) => row.raw ? [row] : []);
        const currentStatuses = currentRows.map((row) => row.raw!);
        const shadowHash = await statusHash(statuses);
        const currentHash = currentStatuses.length
          ? await statusHash(currentStatuses)
          : null;
        const currentObservedAt = currentRows.map((row) =>
          row.observed_at
        ).sort().at(-1) ?? null;
        const comparisonAgeSeconds = currentObservedAt
          ? Math.max(
            0,
            Math.floor(
              (Date.parse(fetchedAt) - Date.parse(currentObservedAt)) / 1000,
            ),
          )
          : null;
        const { error: resultError } = await supabase.from(
          "huaxin_status_shadow_results",
        ).insert({
          ...resultBase,
          outcome: "succeeded",
          fetched_at: fetchedAt,
          current_observed_at: currentObservedAt,
          status_count: canonicalStatuses(statuses).length,
          shadow_hash: shadowHash,
          current_hash: currentHash,
          matches_current: currentHash === shadowHash,
          comparison_age_seconds: comparisonAgeSeconds,
          comparison_fresh: comparisonAgeSeconds !== null &&
            comparisonAgeSeconds <= 5 * 60,
          statuses: canonical,
          write_accepted: writeAccepted,
          write_reason: writeReason,
        });
        if (resultError) throw resultError;
        succeeded++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        const { error: auditError } = await supabase.from(
          "huaxin_status_shadow_results",
        ).upsert({
          ...resultBase,
          outcome: "failed",
          error: message.slice(0, 2000),
        }, { onConflict: "run_id,machine_id" });
        if (auditError) {
          throw new Error(
            `${message}; failure audit could not be saved: ${auditError.message}`,
          );
        }
      }
    });

    const status = failed === 0
      ? "succeeded"
      : succeeded > 0
      ? "partial_failure"
      : "failed";
    const { error: finishError } = await supabase.from(
      "huaxin_status_shadow_runs",
    ).update({
      status,
      finished_at: new Date().toISOString(),
      machines_total: succeeded + failed,
      machines_succeeded: succeeded,
      machines_failed: failed,
    }).eq("id", runId);
    if (finishError) throw finishError;
    return Response.json({
      run_id: runId,
      status,
      machines_total: succeeded + failed,
      machines_succeeded: succeeded,
      machines_failed: failed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { error: finishError } = await supabase.from(
      "huaxin_status_shadow_runs",
    ).update({
      status: "failed",
      finished_at: new Date().toISOString(),
      machines_succeeded: succeeded,
      machines_failed: failed,
      machines_total: succeeded + failed,
      error: message.slice(0, 2000),
    }).eq("id", runId);
    return Response.json({
      run_id: runId,
      error: finishError
        ? `${message}; run finalization failed: ${finishError.message}`
        : message,
    }, { status: 500 });
  }
}

if (import.meta.main) Deno.serve(handler);

export { handler };
