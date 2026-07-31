export type OrderSyncStatus = "succeeded" | "partial" | "failed";

export function orderSyncStatus(succeeded: number, failed: number): OrderSyncStatus {
  if (!succeeded) return "failed";
  return failed ? "partial" : "succeeded";
}
