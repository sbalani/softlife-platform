export type RefillAgeState = "never" | "fresh" | "due" | "overdue";

export function refillAge(lastRefillAt: string | null, now = Date.now()): { state: RefillAgeState; days: number | null } {
  if (!lastRefillAt) return { state: "never", days: null };
  const refillTime = Date.parse(lastRefillAt);
  if (!Number.isFinite(refillTime)) return { state: "never", days: null };
  const age = Math.max(0, now - refillTime);
  const days = Math.floor(age / 86_400_000);
  return { state: age > 14 * 86_400_000 ? "overdue" : age >= 7 * 86_400_000 ? "due" : "fresh", days };
}
