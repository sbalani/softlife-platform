"use client";

import { useState } from "react";
import { VBarChart } from "@/components/charts";

type MachineDatum = { label: string; value: number; units: number; href?: string };

export function MachineChartClient({ data }: { data: MachineDatum[] }) {
  const [mode, setMode] = useState<"euro" | "units">("euro");

  const chartData = mode === "euro"
    ? data.map((d) => ({ label: d.label, value: d.value, href: d.href }))
    : data.map((d) => ({ label: d.label, value: d.units, href: d.href }));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg font-bold text-cocoa">Top machines by sales</h2>
          <p className="text-xs text-taupe">Completed orders (30 days)</p>
        </div>
        <div className="flex rounded-lg border border-line bg-cream/50 p-0.5">
          <button
            onClick={() => setMode("euro")}
            className={`rounded-md px-3 py-1 text-xs font-bold transition ${
              mode === "euro" ? "bg-terracotta text-white" : "text-taupe hover:text-cocoa"
            }`}
          >
            € Euro
          </button>
          <button
            onClick={() => setMode("units")}
            className={`rounded-md px-3 py-1 text-xs font-bold transition ${
              mode === "units" ? "bg-terracotta text-white" : "text-taupe hover:text-cocoa"
            }`}
          >
            Units
          </button>
        </div>
      </div>
      {chartData.length > 0 ? (
        <VBarChart
          data={chartData}
          color="#d47e54"
          unit={mode === "euro" ? "" : ""}
          formatValue={mode === "euro" ? (v) => `€${v.toFixed(2)}` : (v) => `${v}`}
        />
      ) : (
        <p className="flex h-52 items-center justify-center text-sm text-taupe">No machine revenue data.</p>
      )}
    </div>
  );
}
