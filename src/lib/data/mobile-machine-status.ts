import { statusDisplayRank, type HuaxinStatusRow } from "../huaxin/status-signals.ts";
import { translateStatusDesc, translateStatusValue } from "../i18n/huaxin.ts";

export type MachineStatusSnapshot = {
  field: string;
  raw: HuaxinStatusRow;
  observed_at: string;
};

export function presentMachineStatuses(rows: MachineStatusSnapshot[], now = Date.now()) {
  const statuses = [...new Map(rows.map((row) => [row.raw.code ?? row.field, row])).values()]
    .sort((a, b) => statusDisplayRank(a.raw) - statusDisplayRank(b.raw)
      || translateStatusDesc(a.raw.desc ?? a.raw.code ?? a.field).localeCompare(translateStatusDesc(b.raw.desc ?? b.raw.code ?? b.field)))
    .map((row) => ({
      code: row.raw.code ?? row.field,
      label: translateStatusDesc(row.raw.desc ?? row.raw.code ?? row.field),
      value: translateStatusValue(row.raw.value ?? String(row.raw.data ?? "")),
      observed_at: row.observed_at,
    }));
  const observedTimes = statuses.map((status) => Date.parse(status.observed_at)).filter(Number.isFinite);
  const newestTime = observedTimes.length ? Math.max(...observedTimes) : null;
  return {
    statuses,
    status_observed_at: newestTime == null ? null : new Date(newestTime).toISOString(),
    status_stale: newestTime == null || now - newestTime > 2 * 60 * 60 * 1000,
  };
}
