import Link from "next/link";
import { getMachines } from "@/lib/data/machines";
import { SyncStatusesButton } from "./SyncStatusesButton";

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

  const { machines, source } = await getMachines();

  const isActive = (m: (typeof machines)[number]) => m.state === "active";
  const filtered = machines.filter((m) => {
    const matchesQ =
      !q ||
      [m.name, m.ref, m.device_imei, m.customer]
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

  const Chip = ({ value, label }: { value: string; label: string }) => {
    const active = status === value;
    return (
      <Link
        href={chipHref(value, sp.q ?? "")}
        className={`rounded-full px-3 py-1.5 text-sm font-semibold transition ${
          active ? "bg-terracotta text-white" : "bg-white text-cocoa hover:bg-cream"
        }`}
      >
        {label}
      </Link>
    );
  };

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

      <div className="mb-4 flex items-center gap-2">
        <Chip value="all" label={`All (${counts.all})`} />
        <Chip value="active" label={`Active (${counts.active})`} />
        <Chip value="inactive" label={`Inactive (${counts.inactive})`} />
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
              <th className="px-4 py-3 font-bold">#</th>
              <th className="px-4 py-3 font-bold">Machine Name</th>
              <th className="px-4 py-3 font-bold">Machine No</th>
              <th className="px-4 py-3 font-bold">Location</th>
              <th className="px-4 py-3 font-bold">Enrolled</th>
              <th className="px-4 py-3 font-bold">Status</th>
              <th className="px-4 py-3 text-center font-bold">Trays</th>
              <th className="px-4 py-3 text-center font-bold">Net</th>
              <th className="px-4 py-3 text-center font-bold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((m, i) => {
              const idx = (safePage - 1) * pageSize + i + 1;
              return (
                <tr key={m.id} className="hover:bg-cream/50">
                  <td className="px-4 py-3 text-taupe">{idx}</td>
                  <td className="px-4 py-3 font-semibold text-cocoa">{m.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-taupe">{m.ref ?? m.device_imei ?? "—"}</td>
                  <td className="px-4 py-3 text-cocoa">{m.customer ?? "—"}</td>
                  <td className="px-4 py-3 text-taupe">
                    {m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${
                        m.state === "active" ? "bg-sage/15 text-sage" : "bg-taupe/15 text-taupe"
                      }`}
                    >
                      {m.state === "active" ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-cocoa">{m.ingredient_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${m.net_online ? "bg-sage" : "bg-taupe/40"}`}
                      />
                      <span className="text-xs text-taupe">{m.net_online ? "On" : "Off"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1 text-taupe">
                      {m.device_imei ? (
                        <Link
                          title="View"
                          href={`/machines/${m.device_imei}`}
                          className="rounded p-1.5 hover:bg-cream"
                        >
                          👁
                        </Link>
                      ) : (
                        <button title="View" disabled className="rounded p-1.5 opacity-40">
                          👁
                        </button>
                      )}
                      <button title="Edit" className="rounded p-1.5 hover:bg-cream">✎</button>
                      <button title="Delete" className="rounded p-1.5 hover:bg-cream">🗑</button>
                      <button title="Settings" className="rounded p-1.5 hover:bg-cream">⚙</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-taupe">
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

      {source === "sample" && (
        <p className="mt-4 text-xs text-taupe">Sample data — connect Supabase to see live machines.</p>
      )}
    </div>
  );
}
