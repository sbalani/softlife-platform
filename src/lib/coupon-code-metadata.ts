export type CouponCodeMetadata = {
  huaxin_coupon_id: string;
  coupon_code: string;
  distributed: boolean;
  extra_information: string | null;
  revision: number;
};

export type CouponCodeRecord = Record<string, unknown> & {
  code?: string;
  status?: string;
  expireTime?: string;
  createTime?: string;
  distributed: boolean;
  extraInformation: string | null;
  metadataRevision: number | null;
};

export function mergeCouponCodeMetadata(records: unknown[], metadata: CouponCodeMetadata[]): CouponCodeRecord[] {
  const byCode = new Map(metadata.map((row) => [row.coupon_code, row]));
  return records.map((value) => {
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const code = typeof record.code === "string" ? record.code : undefined;
    const local = code ? byCode.get(code) : undefined;
    return { ...record, code, distributed: local?.distributed ?? false, extraInformation: local?.extra_information ?? null, metadataRevision: local?.revision ?? null };
  });
}

export function validateCouponCodeMetadata(code: string, extraInformation: string) {
  const normalizedCode = code.trim();
  const normalizedInformation = extraInformation.trim();
  if (!normalizedCode || normalizedCode.length > 200) return { error: "Invalid coupon code." } as const;
  if (normalizedInformation.length > 1000) return { error: "Extra information must be 1,000 characters or fewer." } as const;
  return { code: normalizedCode, extraInformation: normalizedInformation || null } as const;
}
