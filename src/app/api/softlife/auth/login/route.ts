import { NextResponse } from "next/server";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

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
  const { data: profile } = await service.from("profiles").select("role,full_name").eq("id", data.user.id).maybeSingle();

  return NextResponse.json({
    token: data.session.access_token,
    user: {
      // A real Supabase user id (uuid string) — NOT the old fake numeric uid.
      // The mobile app's SessionUser.uid/local schema still expect a number;
      // that side needs updating before this can be wired up end-to-end.
      uid: data.user.id,
      name: profile?.full_name ?? data.user.email ?? "User",
      login: data.user.email ?? login,
      role: profile?.role === "admin" ? "admin" : "operator",
      warehouse_id: 1,
    },
  });
}
