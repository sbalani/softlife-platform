export type DefrostStatusRow = { code?: string; value?: string; data?: string | number };

export function defrostStatusValue(rows: DefrostStatusRow[], code: string): string | null {
  const row = rows.find((status) => status.code === code);
  return row == null ? null : String(row.value ?? row.data ?? "").trim();
}

export function isHuaxinOpen(value: string | null): boolean {
  return ["abrir", "open", "on", "开"].includes(value?.trim().toLowerCase() ?? "");
}

export function isHuaxinClosed(value: string | null): boolean {
  return ["cierre", "close", "closed", "off", "关"].includes(value?.trim().toLowerCase() ?? "");
}

export function huaxinOperatingStateCode(value: string | null): string | null {
  return value?.match(/^\[(\d+)]/)?.[1] ?? null;
}

export function isHuaxinSalesBlocked(value: string | null): boolean {
  return ["9", "105"].includes(huaxinOperatingStateCode(value) ?? "");
}

export function isHuaxinSalesReady(value: string | null): boolean {
  return value?.trim().toLowerCase() === "normal" || huaxinOperatingStateCode(value) === "11";
}

export function defrostFormationPct(rows: DefrostStatusRow[]): number | null {
  const raw = defrostStatusValue(rows, "status_0_percent");
  if (!raw) return null;
  const value = Number(raw.replace(/%$/, ""));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
