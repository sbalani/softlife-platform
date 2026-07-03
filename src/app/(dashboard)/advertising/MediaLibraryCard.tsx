"use client";

import { useState, useTransition } from "react";
import { assignToMachines } from "./actions";
import type { MediaItem } from "@/lib/data/media";

type Machine = { device_imei: string | null; name: string };

export function MediaLibraryCard({ item, machines }: { item: MediaItem; machines: Machine[] }) {
  const [showAssign, setShowAssign] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const eligibleMachines = machines.filter((m) => m.device_imei);
  const toggle = (imei: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(imei)) next.delete(imei);
      else next.add(imei);
      return next;
    });
  };
  const selectAll = () => {
    setSelected(new Set(eligibleMachines.map((m) => m.device_imei!)));
  };

  const push = () => {
    const imeis = Array.from(selected);
    if (!imeis.length) return;
    startTransition(async () => {
      const res = await assignToMachines(item.url, item.type, item.duration, imeis);
      setResult(
        res.ok
          ? `Pushed to ${res.assigned} machine(s).${res.errors.length ? ` Errors: ${res.errors.join("; ")}` : ""}`
          : `Failed: ${res.errors.join("; ")}`,
      );
    });
  };

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex gap-3">
        {item.type === "image" ? (
          <img src={item.url} alt={item.name ?? "media"} className="h-16 w-24 rounded-lg object-cover" />
        ) : (
          <div className="flex h-16 w-24 items-center justify-center rounded-lg bg-cream text-taupe">Video</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-cocoa">{item.name ?? "Unnamed"}</div>
          <div className="text-xs text-taupe">
            {item.type} · {item.duration}s · {new Date(item.created_at).toLocaleDateString()}
          </div>
          <button
            onClick={() => setShowAssign(!showAssign)}
            className="mt-1 text-xs font-bold text-terracotta hover:underline"
          >
            {showAssign ? "Hide" : "Assign to machines"}
          </button>
        </div>
      </div>

      {showAssign && (
        <div className="mt-3 border-t border-line pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-taupe">
              {selected.size} selected
            </span>
            <button onClick={selectAll} className="text-[10px] font-bold text-terracotta hover:underline">
              Select all
            </button>
          </div>
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {eligibleMachines.map((m) => (
              <label key={m.device_imei} className="flex cursor-pointer items-center gap-2 text-xs text-cocoa">
                <input
                  type="checkbox"
                  checked={selected.has(m.device_imei!)}
                  onChange={() => toggle(m.device_imei!)}
                  className="accent-terracotta"
                />
                {m.name}
              </label>
            ))}
            {eligibleMachines.length === 0 && (
              <p className="text-xs text-taupe">No machines with a device IMEI available.</p>
            )}
          </div>
          <button
            onClick={push}
            disabled={pending || selected.size === 0}
            className="mt-2 rounded-lg bg-cocoa px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Pushing…" : `Push to ${selected.size} machine(s)`}
          </button>
          {result && <p className="mt-1 text-[10px] text-taupe">{result}</p>}
        </div>
      )}
    </div>
  );
}
