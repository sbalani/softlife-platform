import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { SessionProfile } from "@/lib/auth/session";

export async function getApiSession(req: Request) {
  if (!isSupabaseConfigured()) return null;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { createClient } = await import("@supabase/supabase-js");
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await (await createServiceClient()).from("profiles").select("role,tenant_id").eq("id", user.id).maybeSingle();
  const rawRole = String(profile?.role ?? "operator");
  const role: SessionProfile["role"] = rawRole === "admin" || rawRole === "franchisee" ? rawRole : "operator";
  return { id: user.id, role, tenantId: (profile?.tenant_id as string) ?? null };
}
