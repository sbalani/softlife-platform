export const DEFAULT_SERVICE_ORIGIN = "https://softlife-platform.vercel.app";

export function machineServiceUrl(machineId: string, origin = process.env.SERVICE_PUBLIC_ORIGIN || DEFAULT_SERVICE_ORIGIN) {
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:") throw new Error("SERVICE_PUBLIC_ORIGIN must use HTTPS");
  return `${parsed.origin}/machine/${encodeURIComponent(machineId)}`;
}
