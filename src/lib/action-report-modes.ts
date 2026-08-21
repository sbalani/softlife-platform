export const ACTION_REPORT_MODES = ["cleaning", "refill", "other"] as const;

export type ActionReportMode = typeof ACTION_REPORT_MODES[number];
export type LegacyActionReportKind = "cleaning" | "refill" | "both" | "other";

export function modesFromLegacyKind(kind: unknown): ActionReportMode[] {
  if (kind === "both") return ["cleaning", "refill"];
  return ACTION_REPORT_MODES.includes(kind as ActionReportMode) ? [kind as ActionReportMode] : [];
}

export function parseActionReportModes(value: unknown, legacyKind?: unknown): ActionReportMode[] | null {
  const raw = Array.isArray(value) ? value : modesFromLegacyKind(legacyKind);
  if (!raw.length || raw.some((mode) => !ACTION_REPORT_MODES.includes(mode as ActionReportMode))) return null;
  const modes = ACTION_REPORT_MODES.filter((mode) => raw.includes(mode));
  return modes.length === raw.length ? modes : null;
}

export function legacyKindFromModes(modes: readonly ActionReportMode[]): LegacyActionReportKind {
  if (modes.includes("cleaning") && modes.includes("refill")) return "both";
  if (modes.includes("refill")) return "refill";
  if (modes.includes("cleaning")) return "cleaning";
  return "other";
}

export function actionReportModesLabel(modes: readonly ActionReportMode[]): string {
  return modes.map((mode) => mode === "cleaning" ? "Cleaning" : mode === "refill" ? "Refill" : "Other").join(" + ");
}
