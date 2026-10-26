import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { NotificationData } from "@/lib/notifications";

export type UserNotification = {
  id: string;
  title: string;
  body: string;
  href: string;
  data: NotificationData;
  read_at: string | null;
  created_at: string;
};

export async function getUserNotifications(userId: string): Promise<UserNotification[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await (await createServiceClient())
    .from("user_notifications")
    .select("id,title,body,href,data,read_at,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data as UserNotification[]) ?? [];
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { count, error } = await (await createServiceClient())
    .from("user_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}
