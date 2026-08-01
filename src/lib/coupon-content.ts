export function buildCouponContent(fields: Record<string, string>, secondary: number) {
  if (!Number.isSafeInteger(secondary) || secondary < 1) throw new Error("Invalid coupon use count");
  return JSON.stringify({ ...fields, secondary: String(secondary) });
}

export function parseCouponUseCount(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseCouponSecondary(content?: string) {
  if (!content) return null;
  try {
    return parseCouponUseCount((JSON.parse(content) as { secondary?: unknown }).secondary);
  } catch {
    return null;
  }
}
