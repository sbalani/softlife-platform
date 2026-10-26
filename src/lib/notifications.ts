import type { SessionProfile } from "./auth/session.ts";

export type NotificationData = {
  settlementId?: string;
  tenantId?: string;
  amountCents?: number;
  periodMonth?: string;
  paymentReference?: string;
};

export function canAccessNotifications(role: SessionProfile["role"]) {
  return role === "admin" || role === "franchisee";
}

export function safeNotificationHref(href: string) {
  return href === "/payouts" ? href : "/notifications";
}

export function notificationAmount(data: NotificationData) {
  if (!Number.isSafeInteger(data.amountCents) || (data.amountCents ?? 0) < 0) return null;
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(data.amountCents! / 100);
}
