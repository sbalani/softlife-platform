"use server";

import { revalidatePath } from "next/cache";
import { getSessionProfile } from "@/lib/auth/session";
import { canAccessNotifications } from "@/lib/notifications";
import { createServiceClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function markNotificationRead(formData: FormData) {
  const session = await getSessionProfile();
  const notificationId = String(formData.get("notification_id") ?? "");
  if (!session || !canAccessNotifications(session.role) || !UUID.test(notificationId)) return;

  const { error } = await (await createServiceClient())
    .from("user_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", session.id)
    .is("read_at", null);
  if (error) throw error;
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}
