import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MOBILE_APK_BUCKET = "mobile-apks";
export const MOBILE_APK_MAX_BYTES = 200 * 1024 * 1024;

export type MobileBuildInput = {
  artifactUrl: string;
  version: string | null;
  buildNumber: string | null;
  releaseNotes: string | null;
};

export type MobileApkBuild = {
  id: string;
  version: string | null;
  build_number: string | null;
  release_notes: string | null;
  object_path: string;
  byte_size: number;
  sha256: string;
  published_at: string;
};

function optionalText(value: unknown, maxLength: number): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error("Optional build metadata must be text.");
  const text = value.trim();
  if (!text || text.length > maxLength) throw new Error(`Build metadata must be between 1 and ${maxLength} characters.`);
  return text;
}

export function isAllowedExpoArtifactUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "expo.dev"
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/artifacts\/eas\/[A-Za-z0-9_-]+\.apk$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isAllowedExpoDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && !url.username && !url.password && (
      url.hostname === "expo.dev"
      || url.hostname === "api.expo.dev"
      || url.hostname.endsWith(".eascdn.net")
    );
  } catch {
    return false;
  }
}

export function parseMobileBuildInput(body: unknown): MobileBuildInput {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const artifactUrl = typeof record.artifact_url === "string" ? record.artifact_url.trim() : "";
  if (!isAllowedExpoArtifactUrl(artifactUrl)) throw new Error("artifact_url must be an Expo EAS .apk artifact URL.");
  return {
    artifactUrl,
    version: optionalText(record.version, 64),
    buildNumber: optionalText(record.build_number, 64),
    releaseNotes: optionalText(record.release_notes, 2000),
  };
}

export function validWebhookSecret(header: string | null, secret: string): boolean {
  const supplied = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const suppliedBytes = Buffer.from(supplied);
  const secretBytes = Buffer.from(secret);
  return suppliedBytes.length === secretBytes.length && timingSafeEqual(suppliedBytes, secretBytes);
}

async function fetchExpoArtifact(sourceUrl: string, signal: AbortSignal) {
  let currentUrl = sourceUrl;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const response = await fetch(currentUrl, { signal, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Expo artifact redirect did not include a location.");
    const nextUrl = new URL(location, currentUrl).toString();
    if (!isAllowedExpoDownloadUrl(nextUrl)) throw new Error("Expo artifact redirected to an untrusted host.");
    currentUrl = nextUrl;
  }
  throw new Error("Expo artifact exceeded the redirect limit.");
}

export async function streamExpoApkToStorage(sourceUrl: string, objectPath: string, signal: AbortSignal) {
  const source = await fetchExpoArtifact(sourceUrl, signal);
  if (!source.ok || !source.body) throw new Error(`Expo artifact download failed with HTTP ${source.status}.`);
  if (!isAllowedExpoDownloadUrl(source.url)) throw new Error("Expo artifact redirected to an untrusted host.");
  const declaredSize = Number(source.headers.get("content-length") ?? 0);
  if (declaredSize > MOBILE_APK_MAX_BYTES) throw new Error("APK exceeds the 200 MB storage limit.");

  const hash = createHash("sha256");
  let byteSize = 0;
  let prefix = Buffer.alloc(0);
  const checked = { magic: false };
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      byteSize += chunk.byteLength;
      if (byteSize > MOBILE_APK_MAX_BYTES) throw new Error("APK exceeds the 200 MB storage limit.");
      hash.update(chunk);
      if (!checked.magic) {
        prefix = Buffer.concat([prefix, Buffer.from(chunk)]);
        if (prefix.length >= 4) {
          checked.magic = prefix[0] === 0x50 && prefix[1] === 0x4b && prefix[2] === 0x03 && prefix[3] === 0x04;
          if (!checked.magic) throw new Error("Downloaded artifact is not an APK/ZIP file.");
        }
      }
      controller.enqueue(chunk);
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase storage is not configured.");
  const upload = await fetch(`${supabaseUrl}/storage/v1/object/${MOBILE_APK_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/vnd.android.package-archive",
      "x-upsert": "false",
      ...(declaredSize > 0 ? { "Content-Length": String(declaredSize) } : {}),
    },
    body: source.body.pipeThrough(counter),
    signal,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  if (!upload.ok) throw new Error(`Supabase APK upload failed with HTTP ${upload.status}: ${(await upload.text()).slice(0, 300)}`);
  if (!checked.magic || byteSize === 0) throw new Error("Downloaded APK was empty or invalid.");
  return { byteSize, sha256: hash.digest("hex") };
}

export async function latestBuildUpdateForUser(s: SupabaseClient, userId: string): Promise<MobileApkBuild | null> {
  const { data: build, error } = await s.from("mobile_apk_builds").select("id,version,build_number,release_notes,object_path,byte_size,sha256,published_at")
    .order("published_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!build) return null;
  const { data: state, error: stateError } = await s.from("mobile_apk_user_state").select("downloaded_at,suppressed_at").eq("user_id", userId).eq("build_id", build.id).maybeSingle();
  if (stateError) throw stateError;
  return state?.downloaded_at || state?.suppressed_at ? null : build as MobileApkBuild;
}
