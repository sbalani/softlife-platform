import "server-only";

const DEFAULT_PLATFORM_ORIGIN = "https://platform.softlife.es";

export function passwordSetupUrl() {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_PLATFORM_ORIGIN;
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && origin.hostname === "localhost")) {
    throw new Error("The platform password setup origin must use HTTPS.");
  }
  return new URL("/set-password", origin).toString();
}
