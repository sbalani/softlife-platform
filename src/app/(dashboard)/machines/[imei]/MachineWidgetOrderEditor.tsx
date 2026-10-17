"use client";

import { useActionState, useState } from "react";
import { saveMachineWidgetOrder, type SaveResult } from "./actions";
import { MACHINE_DETAIL_WIDGETS, type MachineDetailWidgetId } from "@/lib/machine-detail-layout";

const LABELS = new Map(MACHINE_DETAIL_WIDGETS.map((widget) => [widget.id, widget.label]));

export function MachineWidgetOrderEditor({ initialOrder, version }: { initialOrder: MachineDetailWidgetId[]; version: string | null }) {
  const [order, setOrder] = useState(initialOrder);
  const [result, action, pending] = useActionState<SaveResult | null, FormData>(saveMachineWidgetOrder, null);
  const [dragged, setDragged] = useState<MachineDetailWidgetId | null>(null);

  function move(id: MachineDetailWidgetId, offset: number) {
    setOrder((current) => {
      const from = current.indexOf(id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  function drop(target: MachineDetailWidgetId) {
    if (!dragged || dragged === target) return;
    setOrder((current) => {
      const next = current.filter((id) => id !== dragged);
      next.splice(next.indexOf(target), 0, dragged);
      return next;
    });
    setDragged(null);
  }

  return (
    <details className="mb-6 overflow-hidden rounded-2xl border border-cocoa/15 bg-white">
      <summary className="cursor-pointer list-none px-5 py-4 font-display text-sm font-bold text-cocoa">Arrange machine page</summary>
      <form action={action} className="border-t border-line p-4">
        <p className="mb-3 text-xs text-taupe">This master order applies to every machine. Drag rows or use the arrow buttons, then save.</p>
        <input type="hidden" name="widget_order" value={JSON.stringify(order)} />
        <input type="hidden" name="version" value={version ?? ""} />
        <ol className="space-y-1.5">
          {order.map((id, index) => (
            <li
              key={id}
              draggable
              onDragStart={() => setDragged(id)}
              onDragEnd={() => setDragged(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => drop(id)}
              className="flex cursor-grab items-center gap-2 rounded-lg border border-line bg-cream/45 px-3 py-2 active:cursor-grabbing"
            >
              <span aria-hidden className="text-taupe">⋮⋮</span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-cocoa">{LABELS.get(id)}</span>
              <button type="button" onClick={() => move(id, -1)} disabled={index === 0} aria-label={`Move ${LABELS.get(id)} up`} className="rounded border border-line bg-white px-2 py-1 text-xs font-bold text-cocoa disabled:opacity-30">↑</button>
              <button type="button" onClick={() => move(id, 1)} disabled={index === order.length - 1} aria-label={`Move ${LABELS.get(id)} down`} className="rounded border border-line bg-white px-2 py-1 text-xs font-bold text-cocoa disabled:opacity-30">↓</button>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button disabled={pending} className="rounded-lg bg-cocoa px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{pending ? "Saving..." : "Save master order"}</button>
          {result && <span className={`text-xs font-semibold ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? "Master order saved." : result.error}</span>}
        </div>
      </form>
    </details>
  );
}
