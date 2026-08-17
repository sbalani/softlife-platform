import { createServiceClient } from "@/lib/supabase/server";
import { MOBILE_APK_BUCKET, parseMobileBuildInput, streamExpoApkToStorage, validWebhookSecret } from "@/lib/mobile-builds";

export const runtime = "nodejs";
export const maxDuration = 300;

type PushToken = { id: string; expo_push_token: string };

async function sendUpdatePushes(s: Awaited<ReturnType<typeof createServiceClient>>, buildId: string, version: string | null) {
  const { data, error } = await s.from("mobile_push_tokens").select("id,expo_push_token");
  if (error) throw error;
  const tokens = (data as PushToken[]) ?? [];
  let accepted = 0;
  for (let offset = 0; offset < tokens.length; offset += 100) {
    const chunk = tokens.slice(offset, offset + 100);
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(chunk.map((token) => ({
        to: token.expo_push_token,
        sound: "default",
        title: "SoftLife app update available",
        body: version ? `Version ${version} is ready to download.` : "A new Android version is ready to download.",
        data: { type: "mobile_app_update", buildId, path: "/downloads" },
        channelId: "app-updates",
      }))),
    });
    if (!response.ok) throw new Error(`Expo update push failed with HTTP ${response.status}.`);
    const tickets = (await response.json() as { data?: { status?: string; details?: { error?: string } }[] }).data ?? [];
    for (let index = 0; index < chunk.length; index++) {
      if (tickets[index]?.status === "ok") accepted++;
      else if (tickets[index]?.details?.error === "DeviceNotRegistered") await s.from("mobile_push_tokens").delete().eq("id", chunk[index].id);
    }
  }
  return { tokens: tokens.length, accepted };
}

async function pruneOldBuilds(s: Awaited<ReturnType<typeof createServiceClient>>) {
  const { data, error } = await s.from("mobile_apk_builds").select("id,object_path")
    .order("published_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw error;
  const old = ((data as { id: string; object_path: string }[]) ?? []).slice(5);
  if (!old.length) return 0;
  const { error: storageError } = await s.storage.from(MOBILE_APK_BUCKET).remove(old.map((build) => build.object_path));
  if (storageError) throw storageError;
  const { error: deleteError } = await s.from("mobile_apk_builds").delete().in("id", old.map((build) => build.id));
  if (deleteError) throw deleteError;
  return old.length;
}

export async function POST(request: Request) {
  const secret = process.env.MOBILE_APK_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: { message: "Mobile build webhook is not configured." } }, { status: 503 });
  if (!validWebhookSecret(request.headers.get("authorization"), secret)) {
    return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }
  const declaredBodySize = Number(request.headers.get("content-length") ?? 0);
  if (declaredBodySize > 16_384) return Response.json({ error: { message: "Request body is too large." } }, { status: 413 });

  let input;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 16_384) return Response.json({ error: { message: "Request body is too large." } }, { status: 413 });
    input = parseMobileBuildInput(JSON.parse(raw));
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : "Invalid JSON body." } }, { status: 400 });
  }

  const s = await createServiceClient();
  const { data: existing, error: existingError } = await s.from("mobile_apk_builds").select("id,version,published_at").eq("expo_url", input.artifactUrl).maybeSingle();
  if (existingError) return Response.json({ error: { message: existingError.message } }, { status: 500 });
  if (existing) return Response.json({ ok: true, duplicate: true, build: existing });

  const buildId = crypto.randomUUID();
  const objectPath = `${buildId}.apk`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 280_000);
  try {
    const artifact = await streamExpoApkToStorage(input.artifactUrl, objectPath, controller.signal);
    const { data: build, error: insertError } = await s.from("mobile_apk_builds").insert({
      id: buildId,
      expo_url: input.artifactUrl,
      version: input.version,
      build_number: input.buildNumber,
      release_notes: input.releaseNotes,
      object_path: objectPath,
      byte_size: artifact.byteSize,
      sha256: artifact.sha256,
    }).select("id,version,build_number,byte_size,sha256,published_at").single();
    if (insertError) {
      await s.storage.from(MOBILE_APK_BUCKET).remove([objectPath]);
      throw insertError;
    }

    let removed = 0;
    try { removed = await pruneOldBuilds(s); }
    catch (error) { console.error("[mobile-build] Retention cleanup failed:", error); }
    let push = { tokens: 0, accepted: 0 };
    try { push = await sendUpdatePushes(s, build.id, build.version); }
    catch (error) { console.error("[mobile-build] Update push failed:", error); }
    return Response.json({ ok: true, duplicate: false, build, retention_removed: removed, push }, { status: 201 });
  } catch (error) {
    await s.storage.from(MOBILE_APK_BUCKET).remove([objectPath]);
    console.error("[mobile-build] Ingestion failed:", error);
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
