import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { passwordSetupUrl } from "@/lib/auth/password-redirect";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: { message: "Not configured" } }, { status: 503 });
  let email = "";
  try {
    email = String((await req.json()).email ?? "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ ok: true });
  }
  if (email && email.length <= 254) {
    const { createClient } = await import("@supabase/supabase-js");
    const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await auth.auth.resetPasswordForEmail(email, {
      redirectTo: passwordSetupUrl(),
    });
    if (error) console.error("[auth] password recovery request failed", { code: error.code, status: error.status, message: error.message });
  }
  return NextResponse.json({ ok: true });
}
