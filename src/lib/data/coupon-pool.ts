import { activeCouponGroups, couponPoolCandidates, mapCouponPoolLeaseRows, type CouponPoolLeaseRow } from "@/lib/coupon-pool";
import { getCouponCodesWithMetadata } from "@/lib/data/coupon-code-metadata";
import { getCoupons } from "@/lib/data/coupons";
import { createServiceClient } from "@/lib/supabase/server";

export async function getAdminCouponPool(poolId: string, actorId: string) {
  const snapshot = await getCoupons();
  if (snapshot.readError) throw new Error(snapshot.readError);

  const groups = activeCouponGroups(snapshot.coupons);
  const records = await Promise.all(groups.map(async (group) => ({
    group,
    records: await getCouponCodesWithMetadata(group.couponId),
  })));
  const candidates = couponPoolCandidates(records);

  const { data, error } = await (await createServiceClient()).rpc("claim_admin_coupon_pool", {
    p_actor_id: actorId,
    p_pool_id: poolId,
    p_candidates: candidates.map((candidate) => ({
      huaxin_coupon_id: candidate.couponId,
      coupon_name: candidate.couponName,
      coupon_code: candidate.code,
      provider_expires_at: candidate.expireTime,
      group_expires_at: candidate.groupExpiresAt,
      extra_information: candidate.extraInformation,
      metadata_revision: candidate.metadataRevision,
    })),
  });
  if (error) throw error;
  return { pool_id: poolId, leases: mapCouponPoolLeaseRows((data as CouponPoolLeaseRow[] | null) ?? []) };
}
