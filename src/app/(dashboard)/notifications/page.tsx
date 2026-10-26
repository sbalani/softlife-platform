import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getUserNotifications } from "@/lib/data/notifications";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { canAccessNotifications, safeNotificationHref } from "@/lib/notifications";
import { markNotificationRead } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await getSessionProfile();
  if (!session || !canAccessNotifications(session.role)) redirect("/dashboard");
  const [notifications, timezone] = await Promise.all([
    getUserNotifications(session.id),
    getDisplayTimezone(),
  ]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-cocoa">Notificaciones</h1>
        <p className="mt-1 text-sm text-taupe">Avisos persistentes de tu cuenta.</p>
      </header>
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        {notifications.map((notification) => (
          <article key={notification.id} className={`border-b border-line p-5 last:border-b-0 ${notification.read_at ? "" : "bg-cream/45"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {!notification.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-terracotta" aria-label="No leída" />}
                  <h2 className="font-bold text-cocoa">{notification.title}</h2>
                </div>
                <p className="mt-2 text-sm leading-6 text-taupe">{notification.body}</p>
                <p className="mt-2 text-xs text-taupe">{formatDateTime(notification.created_at, timezone)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link href={safeNotificationHref(notification.href)} className="rounded-lg border border-terracotta px-3 py-2 text-xs font-bold text-terracotta">Ver pago</Link>
                {!notification.read_at && (
                  <form action={markNotificationRead}>
                    <input type="hidden" name="notification_id" value={notification.id} />
                    <button className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white">Marcar leída</button>
                  </form>
                )}
              </div>
            </div>
          </article>
        ))}
        {notifications.length === 0 && <p className="px-5 py-12 text-center text-sm text-taupe">No tienes notificaciones.</p>}
      </section>
    </div>
  );
}
