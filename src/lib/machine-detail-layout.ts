export const MACHINE_DETAIL_WIDGETS = [
  { id: "monitored_status", label: "Monitored status" },
  { id: "hardware_status", label: "Refrigeration and defrost" },
  { id: "recovery_center", label: "Recovery center" },
  { id: "service_overview", label: "Service overview" },
  { id: "incidents", label: "Open incidents" },
  { id: "pasteurization", label: "Pasteurization alert window" },
  { id: "temperature", label: "Historical temperature" },
  { id: "sales", label: "Sales and orders" },
  { id: "configuration", label: "Configuration and control" },
  { id: "product_menu", label: "Product menu" },
  { id: "location", label: "Location" },
  { id: "service_qr", label: "Cleaning and refill QR" },
  { id: "cleaning_history", label: "Cleaning history" },
  { id: "lots_traceability", label: "Lots and traceability" },
  { id: "screen_media", label: "Screen media" },
  { id: "branding", label: "Machine screen branding" },
] as const;

export type MachineDetailWidgetId = (typeof MACHINE_DETAIL_WIDGETS)[number]["id"];

export const DEFAULT_MACHINE_DETAIL_WIDGET_ORDER = MACHINE_DETAIL_WIDGETS.map((widget) => widget.id);

const WIDGET_IDS = new Set<string>(DEFAULT_MACHINE_DETAIL_WIDGET_ORDER);

export function normalizeMachineDetailWidgetOrder(value: unknown): MachineDetailWidgetId[] {
  const saved = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const valid = saved.flatMap((entry) => {
    if (typeof entry !== "string" || !WIDGET_IDS.has(entry) || seen.has(entry)) return [];
    seen.add(entry);
    return [entry as MachineDetailWidgetId];
  });
  return [...valid, ...DEFAULT_MACHINE_DETAIL_WIDGET_ORDER.filter((id) => !seen.has(id))];
}
