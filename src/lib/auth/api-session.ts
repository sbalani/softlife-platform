import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { SessionProfile } from "@/lib/auth/session";
import { MOBILE_CAPABILITIES, normalizeMobileRole, type MobileSession } from "@/lib/auth/mobile-authorization";

export async function getApiSession(req: Request): Promise<MobileSession | null> {
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
  const { data: profile, error: profileError } = await (await createServiceClient()).from("profiles").select("role,tenant_id,employer_kind,scope_version").eq("id", user.id).maybeSingle();
  if (profileError || !profile) return null;
  const role: SessionProfile["role"] = normalizeMobileRole(profile.role);
  const employerKind = ["softlife", "franchisee", "contractor"].includes(String(profile.employer_kind))
    ? profile.employer_kind as MobileSession["employerKind"] : "softlife";
  return {
    id: user.id,
    email: user.email ?? null,
    role,
    tenantId: (profile.tenant_id as string) ?? null,
    employerKind,
    scopeVersion: Number(profile.scope_version ?? 1),
    capabilities: MOBILE_CAPABILITIES[role],
  };
}
