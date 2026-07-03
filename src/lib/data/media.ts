import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type MediaItem = {
  id: string;
  url: string;
  name: string | null;
  type: string;
  duration: number;
  created_at: string;
};

export async function getMediaItems(): Promise<MediaItem[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s.from("media").select("*").order("created_at", { ascending: false });
    return (data as MediaItem[]) ?? [];
  } catch {
    return [];
  }
}
