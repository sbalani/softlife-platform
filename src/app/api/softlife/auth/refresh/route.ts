import { NextResponse } from "next/server";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { mobileUserProfile } from "@/lib/auth/mobile-authorization";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: { message: "Not configured" } }, { status: 503 });
  const refreshToken = String((await req.json()).refresh_token ?? "");
  if (!refreshToken) return NextResponse.json({ error: { message: "Missing refresh token" } }, { status: 400 });
  const { createClient } = await import("@supabase/supabase-js");
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session || !data.user) return NextResponse.json({ error: { message: "Session expired" } }, { status: 401 });
  try {
    return NextResponse.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      user: await mobileUserProfile(await createServiceClient(), data.user),
    });
  } catch {
    return NextResponse.json({ error: { message: "User profile not configured" } }, { status: 403 });
  }
}
