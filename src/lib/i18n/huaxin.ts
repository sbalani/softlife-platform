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

/** Admin override / server-mode orders have no machine-collected payment.
 *  The franchisee collected payment manually — we need to bill them. */
export function isServerModeOrder(payType: string | null): boolean {
  return payType === "自动制作" || payType === "Admin override";
}
