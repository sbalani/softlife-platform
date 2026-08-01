export type HuaxinStatusRow = { code?: string; value?: string; desc?: string; data?: string | number };

const RESOURCE_FIELDS = {
  status_0_cuplack: "cup_empty",
  status_0_lackmaterial: "material_empty",
} as const;

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
