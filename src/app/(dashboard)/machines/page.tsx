import Link from "next/link";
import { getMachines } from "@/lib/data/machines";
import { SyncStatusesButton } from "./SyncStatusesButton";
import { FleetMap } from "@/components/maps";
import { formatDateTime, ymd } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getOrders } from "@/lib/data/orders";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; status?: string; page?: string };

function chipHref(status: string, q: string) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (q) params.set("q", q);
  const s = params.toString();
  return s ? `/machines?${s}` : "/machines";
}

function pageHref(page: number, q: string, status: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status !== "all") params.set("status", status);
  params.set("page", String(page));
  return `/machines?${params.toString()}`;
}

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const status = sp.status ?? "all";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = 10;
  const tz = await getDisplayTimezone();

  const today = ymd(new Date(), tz);
  const [{ machines, lastSyncedAt, staleMachines, readError }, { orders }] = await Promise.all([
    getMachines(),
    getOrders({ dateFrom: today, dateTo: today, timeZone: tz }),
  ]);
  const salesByImei = new Map<string, number>();
  for (const order of orders) {
    if (!order.device_imei || order.order_state !== "COMPLETE" || order.is_admin_override || order.refund_status === "Refunded") continue;
    salesByImei.set(order.device_imei, (salesByImei.get(order.device_imei) ?? 0) + order.price);
  }
  const mapMarkers = machines
    .filter((m) => m.latitude != null && m.longitude != null)
    .map((m) => ({ name: m.display_name || m.name, location: m.location, lat: m.latitude!, lng: m.longitude!, online: m.net_online }));

  const isActive = (m: (typeof machines)[number]) => m.state === "active";
  const filtered = machines.filter((m) => {
    const matchesQ =
      !q ||
      [m.display_name, m.name, m.ref, m.device_imei, m.customer, m.location]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    const matchesStatus =
      status === "all" ? true : status === "active" ? isActive(m) : !isActive(m);
    return matchesQ && matchesStatus;
  });

  const counts = {
    all: machines.length,
    active: machines.filter(isActive).length,
    inactive: machines.filter((m) => !isActive(m)).length,
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-cocoa">Machines</h1>
          <p className="mt-1 text-sm text-taupe">{filtered.length} machine{filtered.length === 1 ? "" : "s"}</p>
        </div>
        <form className="flex items-center gap-2">
          <input type="hidden" name="status" value={status === "all" ? "" : status} />
          <input
            type="text"
            name="q"
            defaultValue={sp.q ?? ""}
            placeholder="🔍  Search name, IMEI, customer…"
            className="w-72 rounded-lg border border-line bg-white px-4 py-2 text-sm text-cocoa placeholder:text-taupe/70 focus:border-terracotta focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white hover:opacity-90"
          >
            Search
          </button>
        </form>
      </header>

      <p className={`mb-4 text-xs ${readError ? "font-semibold text-danger" : staleMachines ? "font-semibold text-warning" : "text-taupe"}`}>
        {readError ? `Supabase machine read failed: ${readError}` : `Supabase snapshot · Latest metadata sync ${lastSyncedAt ? formatDateTime(lastSyncedAt, tz) : "never"}${staleMachines ? ` · ${staleMachines} machine(s) have stale or missing metadata` : ""}`}
      </p>

      <div className="mb-4 flex items-center gap-2">
        {(["all", "active", "inactive"] as const).map((value) => (
          <Link key={value} href={chipHref(value, sp.q ?? "")} className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize transition ${status === value ? "bg-terracotta text-white" : "bg-white text-cocoa hover:bg-cream"}`}>
            {value} ({counts[value]})
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <SyncStatusesButton />
          <button className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark">
            + Add machine
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-4 py-3 font-bold">Machine</th>
              <th className="px-4 py-3 font-bold">IMEI</th>
              <th className="px-4 py-3 font-bold">Location</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 text-right font-bold">Sales today</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m) => {
              return (
                <tr key={m.id} className="hover:bg-cream/50">
                  <td className="px-4 py-3 font-semibold text-cocoa">{m.device_imei ? <Link href={`/machines/${m.device_imei}`} className="hover:text-terracotta hover:underline">{m.display_name || m.name}</Link> : m.display_name || m.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-taupe">{m.device_imei ?? "—"}</td>
                  <td className="px-4 py-3 text-cocoa">{m.location ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${m.oos ? "bg-danger/15 text-danger" : m.low_stock ? "bg-warning/15 text-warning" : "bg-sage/15 text-sage"}`}>{m.oos ? "OOS" : m.low_stock ? "Low stock" : "OK"}</span>
                      <span className={`text-xs font-semibold ${m.net_online ? "text-sage" : "text-danger"}`}>{m.net_online ? "Online" : "Offline"}</span>
                      {m.active_alert_count > 0 && <span title={`${m.active_alert_count} other active alert(s)`} className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning text-xs font-black text-white">!</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-cocoa">€{(salesByImei.get(m.device_imei ?? "") ?? 0).toFixed(2)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-taupe">
                  No machines match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-taupe">
          <span>
            Page {safePage} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            {safePage > 1 ? (
              <Link
                href={pageHref(safePage - 1, sp.q ?? "", status)}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-cream"
              >
                ◀ Prev
              </Link>
            ) : (
              <span className="rounded-lg border border-line px-3 py-1.5 opacity-40">◀ Prev</span>
            )}
            {safePage < totalPages ? (
              <Link
                href={pageHref(safePage + 1, sp.q ?? "", status)}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-cream"
              >
                Next ▶
              </Link>
            ) : (
              <span className="rounded-lg border border-line px-3 py-1.5 opacity-40">Next ▶</span>
            )}
          </div>
        </div>
      </div>

      {mapMarkers.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Fleet map</h2>
          <FleetMap markers={mapMarkers} />
          {machines.length > mapMarkers.length && (
            <p className="mt-2 text-xs text-taupe">
              {machines.length - mapMarkers.length} machine(s) not yet geocoded — run Settings → Sync now to place them.
            </p>
          )}
        </section>
      )}

    </div>
  );
}
