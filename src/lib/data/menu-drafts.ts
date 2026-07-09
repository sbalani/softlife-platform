import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type MenuDraftItem = {
  position: string;
  goodsName: string;
  price: string;
  imagePath: string;
  marketPrice: string;
};

export type MenuDraft = {
  id: string;
  sourceMachineName: string | null;
  items: MenuDraftItem[];
  createdAt: string;
};

export async function getPendingMenuDraft(machineId: string): Promise<MenuDraft | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("machine_menu_drafts")
      .select("id,source_machine_name,items,created_at")
      .eq("machine_id", machineId)
      .is("applied_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      sourceMachineName: (data.source_machine_name as string) ?? null,
      items: (data.items as MenuDraftItem[]) ?? [],
      createdAt: data.created_at as string,
    };
  } catch {
    return null;
  }
}
