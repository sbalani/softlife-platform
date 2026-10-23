import type { CouponCodeRecord } from "./coupon-code-metadata.ts";
import type { HuaxinCoupon } from "./huaxin/client.ts";

export type ActiveCouponGroup = {
  couponId: string;
  couponName: string | null;
  groupExpiresAt: string;
};

export type CouponPoolCandidate = ActiveCouponGroup & {
  code: string;
  expireTime: string | null;
  extraInformation: string | null;
  metadataRevision: number | null;
};

export type CouponPoolLeaseRow = {
  huaxin_coupon_id: unknown;
  coupon_name: unknown;
  coupon_code: unknown;
  provider_expires_at: unknown;
  lease_token: unknown;
  lease_expires_at: unknown;
  extra_information: unknown;
  metadata_revision: unknown;
};

export type AdminCouponLease = {
  couponId: string;
  couponName: string | null;
  code: string;
  expireTime: string | null;
  leaseToken: string;
  leaseExpiresAt: string;
  distributed: false;
  extraInformation: string | null;
  metadataRevision: number | null;
};

function timestamp(value: unknown, endOfDay: boolean) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.includes("T") || value.includes(" ")
    ? value.replace(" ", "T")
    : `${value}T${endOfDay ? "23:59:59" : "00:00:00"}`;
  const parsed = Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

export function activeCouponGroups(coupons: HuaxinCoupon[], now = Date.now()): ActiveCouponGroup[] {
  return coupons.flatMap((coupon) => {
    const couponId = String(coupon.couponId ?? "");
    const startsAt = timestamp(coupon.startTime, false);
    const expiresAt = timestamp(coupon.endTime, true);
    if (!/^\d+$/.test(couponId) || Number(couponId) < 1 || expiresAt === null || expiresAt <= now || startsAt !== null && startsAt > now) return [];
    return [{
      couponId,
      couponName: typeof coupon.couponName === "string" ? coupon.couponName : null,
      groupExpiresAt: new Date(expiresAt).toISOString(),
    }];
  });
}

export function couponPoolCandidates(
  groups: Array<{ group: ActiveCouponGroup; records: CouponCodeRecord[] }>,
  now = Date.now(),
): CouponPoolCandidate[] {
  const candidates = groups.flatMap(({ group, records }) => records.flatMap((record) => {
    const code = typeof record.code === "string" ? record.code : "";
    const rawExpiry = typeof record.expireTime === "string" && record.expireTime.trim() ? record.expireTime : null;
    const providerExpiresAt = rawExpiry === null ? null : timestamp(rawExpiry, true);
    if (!code || code !== code.trim() || code.length > 200 || String(record.status ?? "0") !== "0" || record.distributed) return [];
    if (rawExpiry !== null && (providerExpiresAt === null || providerExpiresAt <= now)) return [];
    return [{
      ...group,
      code,
      expireTime: providerExpiresAt === null ? null : new Date(providerExpiresAt).toISOString(),
      extraInformation: typeof record.extraInformation === "string" ? record.extraInformation : null,
      metadataRevision: Number.isInteger(record.metadataRevision) ? record.metadataRevision : null,
    }];
  }));

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [`${candidate.couponId}\0${candidate.code}`, candidate])).values()];
  const expiry = (candidate: CouponPoolCandidate) => Math.min(
    Date.parse(candidate.groupExpiresAt),
    candidate.expireTime === null ? Infinity : Date.parse(candidate.expireTime),
  );
  return uniqueCandidates.sort((left, right) => expiry(left) - expiry(right)
    || (left.couponId < right.couponId ? -1 : left.couponId > right.couponId ? 1 : 0)
    || (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
}

export function mapCouponPoolLeaseRows(rows: CouponPoolLeaseRow[]): AdminCouponLease[] {
  return rows.map((row) => {
    if (typeof row.huaxin_coupon_id !== "string" || typeof row.coupon_code !== "string"
      || typeof row.lease_token !== "string" || typeof row.lease_expires_at !== "string") {
      throw new Error("Coupon lease RPC returned an invalid row.");
    }
    return {
      couponId: row.huaxin_coupon_id,
      couponName: typeof row.coupon_name === "string" ? row.coupon_name : null,
      code: row.coupon_code,
      expireTime: typeof row.provider_expires_at === "string" ? row.provider_expires_at : null,
      leaseToken: row.lease_token,
      leaseExpiresAt: row.lease_expires_at,
      distributed: false,
      extraInformation: typeof row.extra_information === "string" ? row.extra_information : null,
      metadataRevision: typeof row.metadata_revision === "number" && Number.isInteger(row.metadata_revision) ? row.metadata_revision : null,
    };
  });
}
