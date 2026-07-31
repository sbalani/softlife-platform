import { formatDateTime } from "@/lib/dates";
import { orderReadFreshness } from "@/lib/data/order-sync-status";
import type { OrderSyncSummary } from "@/lib/data/orders";

export function OrderDataNote({ sync, readError, requestedTo, timeZone }: {
  sync: OrderSyncSummary | null;
  readError?: string;
  requestedTo: string;
  timeZone: string;
}) {
  if (readError) return <p className="mt-4 text-xs font-semibold text-danger">Supabase order read failed: {readError}</p>;
  const freshness = orderReadFreshness(sync, requestedTo);
  if (!sync) return <p className="mt-4 text-xs font-semibold text-warning">Supabase snapshot · No completed fleet sync is recorded.</p>;
  const warning = freshness !== "current";
  return (
    <p className={`mt-4 text-xs ${warning ? "font-semibold text-warning" : "text-taupe"}`}>
      Supabase snapshot · Latest fleet sync {sync.finishedAt ? `finished ${formatDateTime(sync.finishedAt, timeZone)}` : "is still running"} · pulled through {sync.requestedTo}
      {sync.failedMachines ? ` · ${sync.failedMachines} machine(s) failed` : ""}
      {freshness === "stale" ? ` · requested data extends through ${requestedTo}` : ""}
    </p>
  );
}
