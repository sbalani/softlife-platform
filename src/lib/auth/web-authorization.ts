import type { SessionProfile } from "./session.ts";

const FRANCHISEE_PATHS = ["/dashboard", "/analytics", "/alerts", "/incidents", "/refills", "/remote-control", "/coupons"];
const PUBLIC_PATHS = new Set(["/login", "/set-password", "/franchisee-intake", "/franchisee-signup"]);

export function isPublicWebPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || path === "/privacy" || path.startsWith("/privacy/") || path.startsWith("/auth/callback") || path.startsWith("/api");
}

export function canAccessWebPath(role: SessionProfile["role"], path: string): boolean {
  if (role === "admin" || path === "/downloads" || path.startsWith("/downloads/") || path.startsWith("/machine/")) return true;
  if (role === "operator") return path === "/refills" || path.startsWith("/refills/") || path === "/incidents" || path.startsWith("/incidents/");
  return FRANCHISEE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
