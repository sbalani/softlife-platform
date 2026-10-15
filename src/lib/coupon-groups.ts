import type { CouponCodeRecord } from "./coupon-code-metadata";
import type { HuaxinCoupon } from "./huaxin/client";

export type CouponGroup = HuaxinCoupon & {
  records?: CouponCodeRecord[];
  codeCount: number;
  availableCount: number;
  distributedCount: number;
  usedCount: number;
  expiredCount: number;
  availabilityError?: string;
};

function timestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value.includes("T") || value.includes(" ") ? value.replace(" ", "T") : `${value}T23:59:59`);
  return Number.isFinite(parsed) ? parsed : null;
}

function startTimestamp(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value.includes("T") || value.includes(" ") ? value.replace(" ", "T") : `${value}T00:00:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function couponCodeIsAvailable(record: CouponCodeRecord, now = Date.now()) {
  const expiresAt = timestamp(record.expireTime);
  return String(record.status ?? "0") === "0" && !record.distributed && (expiresAt === null || expiresAt >= now);
}

export function couponGroup(coupon: HuaxinCoupon, records: CouponCodeRecord[], now = Date.now(), availabilityError?: string): CouponGroup {
  return {
    ...coupon,
    records,
    codeCount: records.length,
    availableCount: records.filter((record) => couponCodeIsAvailable(record, now)).length,
    distributedCount: records.filter((record) => record.distributed).length,
    usedCount: records.filter((record) => String(record.status ?? "") === "1").length,
    expiredCount: records.filter((record) => String(record.status ?? "") === "2" || (timestamp(record.expireTime) ?? Infinity) < now).length,
    ...(availabilityError ? { availabilityError } : {}),
  };
}

export function sortCouponGroups(groups: CouponGroup[], now = Date.now()) {
  const rank = (group: CouponGroup) => {
    const started = (startTimestamp(group.startTime) ?? -Infinity) <= now;
    const ended = (timestamp(group.endTime) ?? -Infinity) < now;
    return started && !ended && group.availableCount > 0 ? 0 : 1;
  };
  return [...groups].sort((a, b) => rank(a) - rank(b)
    || (timestamp(b.endTime) ?? -Infinity) - (timestamp(a.endTime) ?? -Infinity)
    || String(a.couponName ?? "").localeCompare(String(b.couponName ?? "")));
}
