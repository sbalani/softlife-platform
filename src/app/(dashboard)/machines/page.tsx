import Link from "next/link";
import { getMachines } from "@/lib/data/machines";
import { SyncStatusesButton } from "./SyncStatusesButton";
import { FleetMap } from "@/components/maps";
import { formatDateTime, ymd } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { getOrders } from "@/lib/data/orders";
import { refillAge } from "@/lib/refill-aging";
import { createRefillIncident } from "@/app/actions/incidents";
import { analyticsPresetRange, analyticsRange } from "@/lib/analytics";

export const dynamic = "force-dynamic";

type MachinePeriod = "last-30-days" | "last-10-days" | "last-7-days" | "today" | "custom";
type SearchParams = { q?: string; status?: string; page?: string; period?: string; dateFrom?: string; dateTo?: string };

function addPeriodParams(params: URLSearchParams, period: MachinePeriod, dateFrom: string, dateTo: string) {
  if (period !== "last-30-days") params.set("period", period);
  if (period === "custom") {
    params.set("dateFrom", dateFrom);
    params.set("dateTo", dateTo);
  }
}

function chipHref(status: string, q: string, period: MachinePeriod, dateFrom: string, dateTo: string) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (q) params.set("q", q);
  addPeriodParams(params, period, dateFrom, dateTo);
  const s = params.toString();
  return s ? `/machines?${s}` : "/machines";
}

function pageHref(page: number, q: string, status: string, period: MachinePeriod, dateFrom: string, dateTo: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status !== "all") params.set("status", status);
  addPeriodParams(params, period, dateFrom, dateTo);
  params.set("page", String(page));
  return `/machines?${params.toString()}`;
}

function periodHref(period: Exclude<MachinePeriod, "custom">, q: string, status: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status !== "all") params.set("status", status);
  if (period !== "last-30-days") params.set("period", period);
  const query = params.toString();
  return query ? `/machines?${query}` : "/machines";
}

export default async function MachinesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const status = sp.status ?? "all";
  const period: MachinePeriod = ["last-10-days", "last-7-days", "today", "custom"].includes(sp.period ?? "") ? sp.period as MachinePeriod : "last-30-days";
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = 10;
  const tz = await getDisplayTimezone();

  const today = ymd(new Date(), tz);
  const customRange = analyticsRange({ dateFrom: sp.dateFrom, dateTo: sp.dateTo }, tz);
  const selectedRange = period === "custom"
    ? customRange
    : period === "today"
      ? { ...analyticsPresetRange("today", tz), days: 1 }
      : period === "last-10-days"
        ? { ...analyticsPresetRange("last-10-days", tz), days: 10 }
        : period === "last-7-days"
          ? { ...analyticsPresetRange("last-7-days", tz), days: 7 }
          : { ...analyticsPresetRange("last-30-days", tz), days: 30 };
  const periodDays = selectedRange.days;
  const periodFrom = selectedRange.from;
  const periodTo = selectedRange.to;
  const [{ machines, lastSyncedAt, staleMachines, readError }, { orders }] = await Promise.all([
    getMachines(),
    getOrders({ dateFrom: periodFrom, dateTo: periodTo, timeZone: tz }),
  ]);
  const salesByMachine = new Map<string, { revenue: number; units: number }>();
  for (const order of orders) {
    if (!order.machine_id || order.order_state !== "COMPLETE" || order.is_admin_override || order.refund_status === "Refunded") continue;
    const sales = salesByMachine.get(order.machine_id) ?? { revenue: 0, units: 0 };
    sales.revenue += order.price;
    sales.units += order.nums;
    salesByMachine.set(order.machine_id, sales);
  }
  const mapMarkers = machines
    .filter((m) => m.deployed && m.latitude != null && m.longitude != null)
    .map((m) => ({ name: m.display_name || m.name, location: m.location, lat: m.latitude!, lng: m.longitude!, online: m.net_online }));

  const isDeployed = (m: (typeof machines)[number]) => m.deployed;
  const filtered = machines.filter((m) => {
    const matchesQ =
      !q ||
      [m.display_name, m.name, m.ref, m.device_imei, m.customer, m.location]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    const matchesStatus =
      status === "all" ? true : status === "deployed" ? isDeployed(m) : !isDeployed(m);
    return matchesQ && matchesStatus;
  });

  const counts = {
    all: machines.length,
    deployed: machines.filter(isDeployed).length,
    undeployed: machines.filter((m) => !isDeployed(m)).length,
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
          <input type="hidden" name="period" value={period === "last-30-days" ? "" : period} />
          {period === "custom" && <><input type="hidden" name="dateFrom" value={periodFrom} /><input type="hidden" name="dateTo" value={periodTo} /></>}
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
        {(["all", "deployed", "undeployed"] as const).map((value) => (
          <Link key={value} href={chipHref(value, sp.q ?? "", period, periodFrom, periodTo)} className={`rounded-full px-3 py-1.5 text-sm font-semibold capitalize transition ${status === value ? "bg-terracotta text-white" : "bg-white text-cocoa hover:bg-cream"}`}>
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

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <span className="mr-1 self-center text-xs font-bold uppercase tracking-wide text-taupe">Sales period</span>
        {(["last-30-days", "last-10-days", "last-7-days", "today"] as const).map((value) => <Link key={value} href={periodHref(value, sp.q ?? "", status)} className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${period === value ? "bg-cocoa text-white" : "bg-white text-cocoa hover:bg-cream"}`}>{value === "today" ? "Today" : value.replace("last-", "Last ").replace("-days", " days")}</Link>)}
        <form className="ml-1 flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value="custom" />
          {q && <input type="hidden" name="q" value={sp.q ?? ""} />}
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe">From</span><input type="date" name="dateFrom" defaultValue={periodFrom} max={today} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none" /></label>
          <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe">To</span><input type="date" name="dateTo" defaultValue={periodTo} max={today} className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-xs text-cocoa focus:border-terracotta focus:outline-none" /></label>
          <button className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${period === "custom" ? "border-cocoa bg-cocoa text-white" : "border-line bg-white text-cocoa hover:bg-cream"}`}>Custom</button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-sand/60 text-left text-[11px] uppercase tracking-wide text-taupe">
            <tr>
              <th className="px-4 py-3 font-bold">Machine</th>
              <th className="px-4 py-3 font-bold">IMEI</th>
              <th className="px-4 py-3 font-bold">Location</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 text-right font-bold">{period === "today" ? "Revenue today" : "Avg daily revenue"}</th>
              <th className="px-4 py-3 text-right font-bold">{period === "today" ? "Units today" : "Avg daily units"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m) => {
              const refill = refillAge(m.last_refill_at);
              const sales = salesByMachine.get(m.id) ?? { revenue: 0, units: 0 };
              return (
                <tr key={m.id} className="hover:bg-cream/50">
                  <td className="px-4 py-3 font-semibold text-cocoa">{m.device_imei ? <Link href={`/machines/${m.device_imei}`} className="hover:text-terracotta hover:underline">{m.display_name || m.name}</Link> : m.display_name || m.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-taupe">{m.device_imei ?? "—"}</td>
                  <td className="px-4 py-3 text-cocoa">{m.location ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                       <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${!m.deployed ? "bg-taupe/15 text-taupe" : m.oos ? "bg-danger/15 text-danger" : m.low_stock ? "bg-warning/15 text-warning" : "bg-sage/15 text-sage"}`}>{!m.deployed ? "Not deployed" : m.oos ? "OOS" : m.low_stock ? "Low stock" : "OK"}</span>
                       {m.deployed && <span className={`text-xs font-semibold ${m.net_online ? "text-sage" : "text-danger"}`}>{m.net_online ? "Online" : "Offline"}</span>}
                       {m.open_incident_count > 0 && <Link href="/incidents" className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-bold text-danger">{m.open_incident_count} incident{m.open_incident_count === 1 ? "" : "s"}</Link>}
                       {m.deployed && <span className={`basis-full text-[11px] font-semibold ${refill.state === "overdue" ? "text-danger" : refill.state === "due" ? "text-warning" : refill.state === "fresh" ? "text-sage" : "text-taupe"}`}>{refill.state === "never" ? "Never refilled" : `Last refill ${refill.days}d ago`}</span>}
                       <span className="basis-full text-[11px] font-semibold text-taupe">{m.last_full_clean_date ? `Last cleaning ${formatDateTime(m.last_full_clean_date, tz)}` : "Never cleaned"}</span>
                       {m.deployed && (refill.state === "due" || refill.state === "overdue") && !m.open_refill_incident && <form action={createRefillIncident}><input type="hidden" name="machine_id" value={m.id} /><button className="text-[11px] font-bold text-terracotta hover:underline">Create refill incident</button></form>}
                      {m.deployed && !m.net_online && <span className="basis-full text-[11px] text-taupe">{m.offline_since ? `Offline since ${formatDateTime(m.offline_since, tz)}` : "Offline time unknown"}{m.last_online_at ? ` · Last online ${formatDateTime(m.last_online_at, tz)}` : ""}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-cocoa">€{(sales.revenue / periodDays).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right"><span className="font-display text-lg font-bold text-terracotta">{(sales.units / periodDays).toFixed(period === "today" ? 0 : 2)}</span><span className="ml-1 text-[10px] font-bold uppercase tracking-wide text-taupe">{period === "today" ? "units" : "/ day"}</span></td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-taupe">
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
                href={pageHref(safePage - 1, sp.q ?? "", status, period, periodFrom, periodTo)}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:bg-cream"
              >
                ◀ Prev
              </Link>
            ) : (
              <span className="rounded-lg border border-line px-3 py-1.5 opacity-40">◀ Prev</span>
            )}
            {safePage < totalPages ? (
              <Link
                href={pageHref(safePage + 1, sp.q ?? "", status, period, periodFrom, periodTo)}
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
