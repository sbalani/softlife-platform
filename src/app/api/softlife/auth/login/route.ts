import { NextResponse } from "next/server";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { mobileUserProfile } from "@/lib/auth/mobile-authorization";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { login, password } = await req.json();
  if (!login || !password) {
    return NextResponse.json({ error: { message: "Missing credentials" } }, { status: 400 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: { message: "Not configured" } }, { status: 503 });
  }

  // Plain signInWithPassword against the anon client — validates real
  // credentials (same accounts created from Settings -> Users) without
  // needing the service role for the auth check itself.
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await supabase.auth.signInWithPassword({ email: login, password });
  if (error || !data.session || !data.user) {
    return NextResponse.json({ error: { message: "Invalid credentials" } }, { status: 401 });
  }

  const service = await createServiceClient();
  let user;
  try {
    user = await mobileUserProfile(service, data.user);
  } catch {
    return NextResponse.json({ error: { message: "User profile not configured" } }, { status: 403 });
  }

  return NextResponse.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    user,
  });
}
