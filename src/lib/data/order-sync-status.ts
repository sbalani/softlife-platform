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
