import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type Allergen = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
};

export async function getAllergens(): Promise<Allergen[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s.from("allergens").select("id,name,slug,logo_url").order("name");
    return (data as Allergen[]) ?? [];
  } catch {
    return [];
  }
}
