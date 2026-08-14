import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** /api/* is excluded on purpose — the mobile app and server-to-server
 *  callbacks (Huaxin webhook, Vercel cron) authenticate with their own
 *  bearer tokens / shared secrets, not a browser cookie session. */
function isPublicPath(pathname: string) {
  return pathname === "/login" || pathname === "/set-password" || pathname === "/franchisee-intake" || pathname.startsWith("/auth/callback") || pathname.startsWith("/api");
}

export async function middleware(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response = NextResponse.next({ request });
  if (!supabaseUrl || !supabaseAnonKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  if (!user && !isPublicPath(path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && !isPublicPath(path)) {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const role = profile?.role;
    const franchiseePaths = ["/dashboard", "/analytics", "/alerts", "/remote-control", "/coupons"];
    const machineService = path.startsWith("/machine/");
    const allowed = role === "admin" || machineService || (role === "operator" && path.startsWith("/refills")) || (role === "franchisee" && franchiseePaths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
    if (!allowed) {
      const url = request.nextUrl.clone();
      url.pathname = role === "franchisee" ? "/dashboard" : "/refills";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
