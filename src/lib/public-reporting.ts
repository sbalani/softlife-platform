export const PUBLIC_REPORT_BUCKET = "public-incident-evidence";
export const MAX_REPORT_TOTAL_BYTES = 75 * 1024 * 1024;

export const PUBLIC_REPORT_FILE_TYPES = {
  "image/jpeg": { kind: "image", extension: "jpg", maxBytes: 4 * 1024 * 1024 },
  "image/png": { kind: "image", extension: "png", maxBytes: 4 * 1024 * 1024 },
  "image/webp": { kind: "image", extension: "webp", maxBytes: 4 * 1024 * 1024 },
  "image/heic": { kind: "image", extension: "heic", maxBytes: 4 * 1024 * 1024 },
  "image/heif": { kind: "image", extension: "heif", maxBytes: 4 * 1024 * 1024 },
  "video/mp4": { kind: "video", extension: "mp4", maxBytes: 50 * 1024 * 1024 },
  "video/webm": { kind: "video", extension: "webm", maxBytes: 50 * 1024 * 1024 },
  "video/quicktime": { kind: "video", extension: "mov", maxBytes: 50 * 1024 * 1024 },
  "audio/webm": { kind: "audio", extension: "webm", maxBytes: 20 * 1024 * 1024 },
  "audio/mpeg": { kind: "audio", extension: "mp3", maxBytes: 20 * 1024 * 1024 },
  "audio/wav": { kind: "audio", extension: "wav", maxBytes: 20 * 1024 * 1024 },
  "audio/wave": { kind: "audio", extension: "wav", maxBytes: 20 * 1024 * 1024 },
  "audio/x-wav": { kind: "audio", extension: "wav", maxBytes: 20 * 1024 * 1024 },
  "audio/mp4": { kind: "audio", extension: "m4a", maxBytes: 20 * 1024 * 1024 },
  "audio/x-m4a": { kind: "audio", extension: "m4a", maxBytes: 20 * 1024 * 1024 },
} as const;

export type PublicReportMime = keyof typeof PUBLIC_REPORT_FILE_TYPES;

export function publicReportFile(mime: unknown, filename: unknown, size: unknown) {
  const rawMime = typeof mime === "string" ? mime.toLowerCase().split(";")[0] : "";
  const extension = typeof filename === "string" ? filename.toLowerCase().split(".").pop() : "";
  const fallback: Record<string, PublicReportMime> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", mov: "video/quicktime" };
  const normalized = (rawMime in PUBLIC_REPORT_FILE_TYPES ? rawMime : fallback[extension ?? ""]) as PublicReportMime | undefined;
  const sizeBytes = Number(size);
  if (!normalized) return { error: "Unsupported attachment type." } as const;
  const config = PUBLIC_REPORT_FILE_TYPES[normalized];
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > config.maxBytes) return { error: `${config.kind} file is too large.` } as const;
  return { mimeType: normalized, sizeBytes, ...config } as const;
}

export function publicReportContact(input: Record<string, unknown>) {
  const reporterName = typeof input.reporter_name === "string" ? input.reporter_name.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
  if (typeof input.website === "string" && input.website.trim()) return { error: "Unable to submit report." } as const;
  if (!reporterName || reporterName.length > 120) return { error: "Enter your name." } as const;
  if (!phone && !email) return { error: "Enter a phone number or email address." } as const;
  if (phone && (phone.length < 5 || phone.length > 40)) return { error: "Enter a valid phone number." } as const;
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { error: "Enter a valid email address." } as const;
  if (input.contact_consent !== true) return { error: "You must agree that SoftLife may contact you." } as const;
  if (explanation.length > 4000) return { error: "The explanation is too long." } as const;
  return { reporterName, phone: phone || null, email: email || null, explanation: explanation || null } as const;
}

export function submissionBearer(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; }
  catch { return false; }
}
