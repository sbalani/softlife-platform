import { createClient } from "@/lib/supabase/server";

export type SessionProfile = {
  id: string;
  email: string | null;
  role: "admin" | "operator";
  full_name: string | null;
};

/** Current signed-in user + profile, read via the per-request cookie client
 *  (so it respects RLS — never use this for privileged writes). Null if
 *  there's no session; middleware is what actually enforces login is
 *  required, this is just for reading who's signed in. */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("role,full_name").eq("id", user.id).maybeSingle();
  const role = (profile?.role as string) === "admin" ? "admin" : "operator";
  return {
    id: user.id,
    email: user.email ?? null,
    role,
    full_name: (profile?.full_name as string) ?? null,
  };
}
