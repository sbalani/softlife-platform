export type HuaxinStatusRow = { code?: string; value?: string; desc?: string; data?: string | number };

const RESOURCE_FIELDS = {
  status_0_cuplack: "cup_empty",
  status_0_lackmaterial: "material_empty",
} as const;

const FAULT_FIELDS = {
  status_0_faultcup: "cup_foreign_object",
  status_0_cupfault: "cup_blocked",
  status_0_cupget: "cup_take_fault",
  status_0_os: "ordering_system_fault",
} as const;

const DISPLAY_ORDER = [
  "status_0_lackmaterial",
  "status_0_online_status",
  "status_0_os",
  "status_0_sellcup",
  "status_0_cuplack",
  "status_0_faultcup",
  "status_0_cupfault",
  "status_0_cupget",
];

export type ResourceStatusSignal = {
  field: "cup_empty" | "material_empty";
  active: boolean;
  row: HuaxinStatusRow;
};

export function resourceStatusSignal(row: HuaxinStatusRow): ResourceStatusSignal | null {
  const field = row.code ? RESOURCE_FIELDS[row.code as keyof typeof RESOURCE_FIELDS] : undefined;
  if (!field) return null;
  const rawData = String(row.data ?? "").trim();
  if (rawData) {
    const data = Number(rawData);
    return { field, active: Number.isFinite(data) && data > 0, row };
  }
  const value = String(row.value ?? "").trim().toLowerCase();
  const active = ["1", "true", "abnormal", "starts lacking material", "liquid level low", "comienza a faltar material"].includes(value);
  return { field, active, row };
}

export function faultStatusSignal(row: HuaxinStatusRow): { field: string; active: boolean; row: HuaxinStatusRow } | null {
  const field = row.code ? FAULT_FIELDS[row.code as keyof typeof FAULT_FIELDS] : undefined;
  if (!field) return null;
  const value = String(row.value ?? row.data ?? "").trim().toLowerCase();
  return { field, active: Boolean(value) && !["0", "false", "normal", "none", "close", "closed", "off", "cierre", "正常", "无", "关"].includes(value), row };
}

export function statusDisplayRank(row: HuaxinStatusRow): number {
  const index = DISPLAY_ORDER.indexOf(row.code ?? "");
  return index < 0 ? DISPLAY_ORDER.length : index;
}
