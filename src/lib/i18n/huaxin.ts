/** Translation table for Chinese terms returned by the Huaxin API.
 *  Add entries here as we encounter new Chinese values in production. */

export const PAY_TYPE_MAP: Record<string, string> = {
  "自动制作": "Admin override",
  "微信支付": "WeChat Pay",
  "支付宝": "Alipay",
  "刷卡": "Card",
  "现金": "Cash",
  "投币": "Coin",
  "扫码支付": "QR Payment",
  "免费": "Free",
};

export function translatePayType(raw: string | null): string | null {
  if (!raw) return null;
  return PAY_TYPE_MAP[raw] ?? raw;
}

/** Admin override = company staff forced a free dispense (testing).
 *  NOT billable. NOT server mode. */
export function isAdminOverride(payType: string | null): boolean {
  return payType === "自动制作" || payType === "Admin override";
}

/** Server mode = franchisee card was used.
 *  End user paid the franchisee; we bill the franchisee their revenue share.
 *  The payType for this is TBD — will be defined when the card system goes live. */
export function isServerModeOrder(payType: string | null): boolean {
  // TODO: add the actual payType string once Huaxin defines the franchisee-card payment type.
  // Example: return payType === "服务器" || payType === "Server mode";
  return false; // placeholder — no known payType yet
}
