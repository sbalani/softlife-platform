"use client";

import { useState, useTransition } from "react";
import { pushMachineSetting } from "./actions";

type Setting = { code?: string; value?: string; desc?: string };

export function DeviceSettingsPanel({ imei, settings }: { imei: string; settings: Setting[] }) {
  const [pending, startTransition] = useTransition();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, string>>({});

  const push = (code: string) => {
    const value = edits[code] ?? "";
    if (!value) return;
    startTransition(async () => {
      const res = await pushMachineSetting(imei, code, value);
      setResults((prev) => ({ ...prev, [code]: res.ok ? "Pushed" : res.error ?? "Failed" }));
    });
  };

  return (
    <div className="space-y-1">
      {settings.map((s, i) => {
        const code = s.code ?? `setting_${i}`;
        return (
          <div key={code} className="flex items-center gap-2 border-b border-line py-2 last:border-0">
            <div className="w-48 shrink-0">
              <div className="text-xs font-semibold text-cocoa">{s.desc ?? code}</div>
              <div className="text-[10px] text-taupe">{code}</div>
            </div>
            <div className="w-24 text-xs text-taupe">Current: {s.value ?? "—"}</div>
            <input
              type="text"
              placeholder={s.value ?? ""}
              onChange={(e) => setEdits((prev) => ({ ...prev, [code]: e.target.value }))}
              className="w-28 rounded border border-line bg-white px-2 py-1 text-xs text-cocoa focus:border-terracotta focus:outline-none"
            />
            <button
              onClick={() => push(code)}
              disabled={pending || !edits[code]}
              className="rounded bg-cocoa px-2 py-1 text-[10px] font-bold text-white hover:opacity-90 disabled:opacity-50"
            >
              Push
            </button>
            {results[code] && (
              <span className={`text-[10px] font-semibold ${results[code] === "Pushed" ? "text-sage" : "text-danger"}`}>
                {results[code]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
