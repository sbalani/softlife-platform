import { getMachines } from "@/lib/data/machines";
import { getLots } from "@/lib/data/lots";
import { getRefillHistory } from "@/lib/data/refills";
import { RefillForm } from "./RefillForm";

export const dynamic = "force-dynamic";

export default async function RefillsPage() {
  const [{ machines }, lots, history] = await Promise.all([getMachines(), getLots(), getRefillHistory()]);

  // FIFO: oldest released stock first — matches the mobile app's suggestion order.
  const availableLots = lots
    .filter((l) => l.disposition === "released")
    .sort((a, b) => {
      if (!a.device_event_time) return 1;
      if (!b.device_event_time) return -1;
      return +new Date(a.device_event_time) - +new Date(b.device_event_time);
    });

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Refills</h1>
        <p className="mt-1 text-sm text-taupe">Log which lot went into which machine — the same flow the mobile app uses.</p>
      </header>

      <section className="mb-8 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Log a refill</h2>
        <RefillForm
          machines={machines.map((m) => ({ id: m.id, name: m.name }))}
          lots={availableLots.map((l) => ({ id: l.id, name: l.name, product_name: l.product_name, qty_available: l.qty_available }))}
        />
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">Recent refills ({history.length})</h2>
        {history.length === 0 ? (
          <div className="rounded-2xl border border-line bg-white p-10 text-center text-taupe">
            No refills logged yet — from the web or the mobile app.
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((r) => (
              <article key={r.id} className="rounded-2xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-display text-base font-bold text-cocoa">{r.machine_name ?? "Unknown machine"}</span>
                    <span className="ml-2 text-xs text-taupe">by {r.operator_name ?? "—"}</span>
                  </div>
                  <span className="text-xs text-taupe">{new Date(r.device_event_time).toLocaleString()}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {r.lines.map((l, i) => (
                    <span key={i} className="rounded-full bg-cream px-2.5 py-1 text-xs text-cocoa">
                      {l.lot_name} · {l.quantity_used}
                      {l.has_photo ? " · 📷" : ""}
                    </span>
                  ))}
                  {r.lines.length === 0 && <span className="text-xs text-taupe">No lines recorded.</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
