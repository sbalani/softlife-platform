import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { createServiceClient } from "@/lib/supabase/server";

const TOKEN_RE = /^(Expo(nent)?PushToken)\[[A-Za-z0-9_-]+]$/;

export async function POST(req: Request) {
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  if (!hasMobileCapability(session, "alerts.read")) return Response.json({ error: { message: "Forbidden" } }, { status: 403 });
  const body = await req.json().catch(() => null) as { token?: unknown; platform?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const platform = body?.platform;
  if (!TOKEN_RE.test(token) || platform !== "android" && platform !== "ios") return Response.json({ error: { message: "Invalid push token." } }, { status: 400 });
  const s = await createServiceClient();
  const { error } = await s.from("mobile_push_tokens").upsert({ user_id: session.id, expo_push_token: token, platform, updated_at: new Date().toISOString() }, { onConflict: "expo_push_token" });
  if (error) return Response.json({ error: { message: error.message } }, { status: 500 });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getApiSession(req);
  if (!session) return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
  const body = await req.json().catch(() => null) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!TOKEN_RE.test(token)) return Response.json({ error: { message: "Invalid push token." } }, { status: 400 });
  const s = await createServiceClient();
  const { error } = await s.from("mobile_push_tokens").delete().eq("user_id", session.id).eq("expo_push_token", token);
  if (error) return Response.json({ error: { message: error.message } }, { status: 500 });
  return Response.json({ ok: true });
}
