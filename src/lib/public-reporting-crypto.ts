import { createHash, createHmac, randomBytes } from "node:crypto";

export function newSubmissionToken() {
  return randomBytes(32).toString("base64url");
}

export function submissionTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function requestIpHash(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  const secret = process.env.PUBLIC_REPORT_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "unconfigured";
  return createHmac("sha256", secret).update(ip).digest("hex");
}
