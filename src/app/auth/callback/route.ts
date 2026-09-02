import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeInternalRedirect } from "@/lib/auth/safe-redirect";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") || "/set-password";
  const next = safeInternalRedirect(requestedNext, url.origin, "/set-password");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  // Admin invitations use implicit tokens in the URL fragment, which is not
  // visible to this server route. Redirecting keeps that fragment in the browser
  // so the client-side password form can establish the invited user's session.
  if (!url.searchParams.has("error") && !url.searchParams.has("error_code")) {
    return NextResponse.redirect(new URL("/set-password", url.origin));
  }

  return NextResponse.redirect(new URL("/login?error=invalid-invite", url.origin));
}
