import { getMachines } from "@/lib/data/machines";

export const dynamic = "force-dynamic";

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    active: "bg-sage/15 text-sage",
    in_transit: "bg-warning/15 text-warning",
    stored: "bg-taupe/15 text-taupe",
    retired: "bg-taupe/15 text-taupe",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${map[state] ?? "bg-cream text-taupe"}`}>
      {state.replace("_", " ")}
    </span>
  );
}

export default async function MachinesPage() {
  const { machines, source } = await getMachines();

  return (
    <div>
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-cocoa">Machines</h1>
          <p className="mt-1 text-sm text-taupe">
            {machines.length} machine{machines.length === 1 ? "" : "s"} in your fleet
          </p>
        </div>
        <div className="flex items-center gap-3">
          {source === "sample" && (
            <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-bold text-warning">
              Sample data — connect Supabase
            </span>
          )}
          <button className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white transition hover:bg-terracotta-dark">
            + Add machine
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {machines.map((m) => (
          <article
            key={m.id}
            className="rounded-2xl border border-line bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-display text-xl font-bold text-cocoa">{m.name}</h2>
                <p className="text-sm text-taupe">{m.customer ?? "Unassigned"}</p>
              </div>
              <StateBadge state={m.state} />
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-taupe">IMEI</dt>
                <dd className="font-mono text-xs text-cocoa">{m.device_imei ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-taupe">Base</dt>
                <dd className="text-cocoa">{m.base_product ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-taupe">Last clean</dt>
                <dd className="text-cocoa">
                  {m.last_full_clean_date
                    ? new Date(m.last_full_clean_date).toLocaleDateString()
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-taupe">Temp</dt>
                <dd className="text-cocoa">
                  {m.latest_temp != null ? `${m.latest_temp.toFixed(1)}°C` : "—"}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <span className="text-xs text-taupe">
                {m.ingredient_count} hopper{m.ingredient_count === 1 ? "" : "s"}
              </span>
              <span className="text-xs font-semibold text-terracotta">View →</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
