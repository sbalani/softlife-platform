import type { HuaxinOrder } from "./client.ts";

function iso(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Huaxin's timezone-less timestamps are China Standard Time (UTC+8). */
export function huaxinLocalTimeToUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().replace(" ", "T");
  const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  return iso(hasOffset ? normalized : `${normalized}+08:00`);
}

export function huaxinOrderTime(order: Pick<HuaxinOrder, "createTimeUtc" | "createTime" | "localPayTime" | "payTime">): string | null {
  // Machines can queue offline sales for days. Huaxin then stamps createTimeUtc
  // with the later cloud-upload time, while localPayTime retains the sale time.
  return huaxinLocalTimeToUtc(order.localPayTime)
    ?? (order.createTimeUtc ? iso(order.createTimeUtc) : null)
    ?? huaxinLocalTimeToUtc(order.createTime)
    ?? huaxinLocalTimeToUtc(order.payTime);
}
