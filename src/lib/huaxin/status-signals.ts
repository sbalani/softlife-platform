export type HuaxinStatusRow = { code?: string; value?: string; desc?: string; data?: string | number };

const RESOURCE_FIELDS = {
  status_0_cuplack: "cup_empty",
  status_0_lackmaterial: "material_empty",
} as const;

const FAULT_FIELDS = {
  status_0_faultcup: "cup_foreign_object",
  status_0_cupfault: "cup_blocked",
  status_0_cupget: "cup_take_fault",
  status_0_overhot: "compressor_overheat",
} as const;

const OPERATING_STATE_FIELDS: Record<string, string> = {
  "8": "material_empty",
  "101": "cup_empty",
  "102": "material_out",
  "104": "cup_take_fault",
  "120": "cup_foreign_object",
  "255": "mixture_ratio_fault",
};

const BENIGN_OPERATING_STATES = new Set(["4", "9", "11", "105"]);
const OPERATING_ACTIONABLE_FIELDS = [...new Set(Object.values(OPERATING_STATE_FIELDS))];

const DISPLAY_ORDER = [
  "status_0_lackmaterial",
  "status_0_online_status",
  "status_0_os",
  "status_0_sellcup",
  "status_0_cuplack",
  "status_0_faultcup",
  "status_0_cupfault",
  "status_0_cupget",
  "status_0_overhot",
];

export type ResourceStatusSignal = {
  field: "cup_empty" | "material_empty";
  active: boolean;
  row: HuaxinStatusRow;
};

export type MaterialRemainingStatus = {
  active: boolean;
  remainingCups: number;
  totalCups: number;
  remainingPct: number;
  level: "normal" | "warning" | "critical";
  outOfStock: boolean;
};

export function iceCreamFormationPct(row: HuaxinStatusRow): number | null {
  if (row.code !== "status_0_percent") return null;
  const raw = String(row.value ?? row.data ?? "").trim().replace(/%$/, "");
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function materialRemainingStatus(row: HuaxinStatusRow): MaterialRemainingStatus | null {
  if (row.code !== "status_0_sellcup") return null;
  const normal = String(row.value ?? "").trim().match(/^normal\s*\[\s*(\d+)\s*]$/i);
  if (normal) {
    const totalCups = Number(normal[1]);
    if (totalCups <= 0) return null;
    return { active: false, remainingCups: totalCups, totalCups, remainingPct: 100, level: "normal", outOfStock: false };
  }
  const counter = [row.value, row.data].map(String).find((value) => /\d+\s*\[\s*\d+\s*]/.test(value));
  const match = counter?.match(/(\d+)\s*\[\s*(\d+)\s*]/);
  if (!match) return null;
  const remainingCups = Number(match[1]);
  const totalCups = Number(match[2]);
  if (totalCups <= 0) return null;
  const remainingPct = Math.max(0, Math.min(100, Math.floor((remainingCups / totalCups) * 100)));
  return {
    active: true,
    remainingCups,
    totalCups,
    remainingPct,
    level: remainingPct <= 25 ? "critical" : remainingPct <= 50 ? "warning" : "normal",
    outOfStock: remainingCups === 0,
  };
}

export function resourceStatusSignal(row: HuaxinStatusRow): ResourceStatusSignal | null {
  const field = row.code ? RESOURCE_FIELDS[row.code as keyof typeof RESOURCE_FIELDS] : undefined;
  if (!field) return null;
  const value = String(row.value ?? "").trim().toLowerCase();
  if (["0", "false", "normal", "none", "available", "正常", "无"].includes(value)) return { field, active: false, row };
  const active = ["1", "true", "abnormal", "anomaly", "anomalies", "anomalía", "anomalías", "anomalia", "anomalias", "starts lacking material", "liquid level low", "comienza a faltar material"].includes(value);
  if (active) return { field, active: true, row };
  const rawData = String(row.data ?? "").trim();
  const data = Number(rawData);
  return { field, active: !value && rawData !== "" && Number.isFinite(data) && data > 0, row };
}

export function faultStatusSignal(row: HuaxinStatusRow): { field: string; active: boolean; row: HuaxinStatusRow } | null {
  if (row.code === "status_0_os") {
    const signals = operatingStatusSignals(row);
    return signals.find((signal) => signal.active) ?? signals[0] ?? null;
  }
  const field = row.code ? FAULT_FIELDS[row.code as keyof typeof FAULT_FIELDS] : undefined;
  if (!field) return null;
  const value = String(row.value ?? row.data ?? "").trim().toLowerCase();
  return { field, active: Boolean(value) && !["0", "false", "normal", "none", "close", "closed", "off", "cierre", "正常", "无", "关"].includes(value), row };
}

export function operatingStatusSignals(row: HuaxinStatusRow): { field: string; active: boolean; row: HuaxinStatusRow }[] {
  if (row.code !== "status_0_os") return [];
  const value = String(row.value ?? row.data ?? "").trim();
  const normalized = value.toLowerCase();
  const stateCode = value.match(/^\[(\d+)]/)?.[1];
  const cleared = OPERATING_ACTIONABLE_FIELDS.map((field) => ({ field, active: false, row }));
  if (!value || ["0", "false", "normal", "none", "close", "closed", "off", "cierre", "正常", "无", "关"].includes(normalized)) {
    return [{ field: "ordering_system_fault", active: false, row }, ...cleared];
  }
  const specificField = stateCode && OPERATING_STATE_FIELDS[stateCode];
  if (specificField) {
    return [{ field: "ordering_system_fault", active: false, row }, ...cleared.map((signal) => signal.field === specificField ? { ...signal, active: true } : signal)];
  }
  if (stateCode && BENIGN_OPERATING_STATES.has(stateCode)) {
    return [{ field: "ordering_system_fault", active: false, row }, ...cleared];
  }
  return [{ field: "ordering_system_fault", active: true, row }, ...cleared];
}

export function statusDisplayRank(row: HuaxinStatusRow): number {
  const index = DISPLAY_ORDER.indexOf(row.code ?? "");
  return index < 0 ? DISPLAY_ORDER.length : index;
}
