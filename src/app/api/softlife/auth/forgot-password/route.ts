import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: { message: "Not configured" } }, { status: 503 });
  const email = String((await req.json()).email ?? "").trim().toLowerCase();
  if (email && email.length <= 254) {
    const { createClient } = await import("@supabase/supabase-js");
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    await auth.auth.resetPasswordForEmail(email, {
      redirectTo: `${new URL(req.url).origin}/auth/callback?next=/set-password`,
    });
  }
  return NextResponse.json({ ok: true });
}
