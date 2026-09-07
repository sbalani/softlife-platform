import { createHash } from "node:crypto";
import { isAdminOverride } from "./i18n/huaxin.ts";
export { localDateTimeToUtc } from "./dates.ts";

export type SyncCursor = { timestamp: string; id: string };

export function normalizeObservedName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("und");
}

export function encodeSyncCursor(cursor: unknown): string {
  return Buffer.from(JSON.stringify({ v: 1, value: cursor }), "utf8").toString("base64url");
}

export function decodeSyncCursor<T>(cursor: string | null, validate: (value: unknown) => value is T): T | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { v?: unknown; value?: unknown };
    return parsed.v === 1 && validate(parsed.value) ? parsed.value : null;
  } catch {
    return null;
  }
}

export function isSyncCursor(value: unknown): value is SyncCursor {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.timestamp === "string" && !Number.isNaN(Date.parse(row.timestamp)) && typeof row.id === "string" && row.id.length > 0;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
}

export function isEligibleManufacturingSale(order: { order_state: string; refund_status: string | null; pay_type_raw: string | null; nums: number }): boolean {
  const complete = order.order_state === "COMPLETE" || order.order_state === "3";
  const refunded = order.refund_status === "Refunded" || order.refund_status === "1";
  return complete && !refunded && !isAdminOverride(order.pay_type_raw) && Number.isInteger(order.nums) && order.nums > 0;
}

export function productionDocumentDate(localTo: string): string {
  const exclusiveDate = localTo.slice(0, 10);
  if (!/T00:00(?::00)?$/.test(localTo)) return exclusiveDate;
  const previous = new Date(`${exclusiveDate}T00:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 1);
  return previous.toISOString().slice(0, 10);
}

export function inclusiveLocalDatePeriod(dateFrom: string, dateTo: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateTo < dateFrom) {
    throw new Error("Select a valid inclusive date range");
  }
  const exclusiveTo = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(exclusiveTo.getTime()) || exclusiveTo.toISOString().slice(0, 10) !== dateTo) throw new Error("Select a valid inclusive date range");
  exclusiveTo.setUTCDate(exclusiveTo.getUTCDate() + 1);
  return { localFrom: `${dateFrom}T00:00`, localTo: `${exclusiveTo.toISOString().slice(0, 10)}T00:00` };
}
