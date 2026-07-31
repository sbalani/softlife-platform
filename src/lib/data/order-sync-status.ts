export type OrderSyncStatus = "succeeded" | "partial" | "failed";

export function orderSyncStatus(succeeded: number, failed: number): OrderSyncStatus {
  if (!succeeded) return "failed";
  return failed ? "partial" : "succeeded";
}

export function orderReadFreshness(run: { status: string; requestedTo: string } | null, requestedTo: string) {
  if (!run) return "missing" as const;
  if (run.status !== "succeeded") return "warning" as const;
  return run.requestedTo >= requestedTo ? "current" as const : "stale" as const;
}

export function coversOrderRange(intervals: { from: string; through: string }[], from: string, to: string) {
  let cursor = from;
  for (const interval of [...intervals].sort((a, b) => a.from.localeCompare(b.from))) {
    if (interval.from > cursor || interval.through < cursor) continue;
    cursor = new Date(Date.parse(`${interval.through}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    if (cursor > to) return true;
  }
  return false;
}
