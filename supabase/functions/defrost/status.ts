export type StatusRow = { code?: string; value?: string; desc?: string; data?: string | number };

const NORMAL_VALUES = new Set(["", "0", "false", "normal", "none", "available", "close", "closed", "off", "cierre", "正常", "无", "关"]);
const CUP_FAULT_CODES = ["status_0_faultcup", "status_0_cupfault", "status_0_cupget"];
const CUP_OPERATING_CODES = new Set(["101", "104", "120"]);

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function activeValue(row: StatusRow) {
  const value = normalized(row.value);
  if (value) return !NORMAL_VALUES.has(value);
  const numericData = Number(row.data);
  if (Number.isFinite(numericData) && numericData > 0) return true;
  return !NORMAL_VALUES.has(normalized(row.data));
}

export function cupAnomalyReason(rows: StatusRow[]): string | null {
  const activeCodes = new Set<string>();
  const cupLack = rows.find((row) => row.code === "status_0_cuplack");
  if (cupLack && activeValue(cupLack)) activeCodes.add("status_0_cuplack");
  for (const code of CUP_FAULT_CODES) {
    const row = rows.find((candidate) => candidate.code === code);
    if (row && activeValue(row)) activeCodes.add(code);
  }
  const operating = rows.find((row) => row.code === "status_0_os");
  const operatingCode = String(operating?.value ?? operating?.data ?? "").match(/^\[(\d+)]/)?.[1];
  if (operatingCode && CUP_OPERATING_CODES.has(operatingCode)) activeCodes.add(`status_0_os[${operatingCode}]`);
  return activeCodes.size ? `active cup anomaly (${[...activeCodes].join(", ")})` : null;
}
