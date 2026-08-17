import type { SessionProfile } from "./session.ts";

const FRANCHISEE_PATHS = ["/dashboard", "/analytics", "/alerts", "/remote-control", "/coupons"];

export function canAccessWebPath(role: SessionProfile["role"], path: string): boolean {
  if (role === "admin" || path === "/downloads" || path.startsWith("/downloads/") || path.startsWith("/machine/")) return true;
  if (role === "operator") return path === "/refills" || path.startsWith("/refills/");
  return FRANCHISEE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
