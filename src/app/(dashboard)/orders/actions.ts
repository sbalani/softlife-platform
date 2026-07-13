"use server";

import { revalidatePath } from "next/cache";
import { ingestOrders } from "@/lib/data/order-sync";

export type UpdateOrdersResult = { ok: boolean; summary: string };

const MAX_RANGE_DAYS = 92;

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

export async function updateOrders(_prev: UpdateOrdersResult | null, fd: FormData): Promise<UpdateOrdersResult> {
  const fromRaw = String(fd.get("from") ?? "").trim();
  const toRaw = String(fd.get("to") ?? "").trim();

  // Default: last 7 days. Advanced: any explicit range (capped so a typo'd
  // year doesn't turn into thousands of paginated Huaxin calls).
  const to = toRaw || ymd(new Date());
  const from = fromRaw || ymd(new Date(Date.now() - 7 * 86_400_000));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { ok: false, summary: "Dates must be YYYY-MM-DD." };
  }
  if (from > to) return { ok: false, summary: "'From' must be before 'to'." };
  const rangeDays = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  if (rangeDays > MAX_RANGE_DAYS) {
    return { ok: false, summary: `Range too large — max ${MAX_RANGE_DAYS} days per update. Run it in chunks.` };
  }

  const res = await ingestOrders(from, to);
  if (!res.ok) return { ok: false, summary: res.error ?? "Update failed." };

  revalidatePath("/orders");
  return { ok: true, summary: `Fetched ${res.orders} order(s) across ${res.machines} machine(s) (${from} → ${to}).` };
}
