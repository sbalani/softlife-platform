export type Locale = "en" | "es";

export const DEFAULT_LOCALE: Locale = "en";

export function normalizeLocale(value: unknown): Locale {
  return value === "es" ? "es" : DEFAULT_LOCALE;
}
