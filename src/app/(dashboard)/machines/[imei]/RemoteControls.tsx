"use client";

import { useState, useTransition } from "react";
import { sendMachineCommand } from "./actions";

const COMMANDS = [
  { command: "operate_clearwarn", label: "Clear alarm", icon: "🔔" },
  { command: "operate_make", label: "Test cup", icon: "🍦" },
  { command: "operate_onsale", label: "Resume sales", icon: "▶" },
  { command: "operate_sellout", label: "Sold out", icon: "⏸" },
  { command: "operate_openrefrigeration", label: "Fridge on", icon: "❄" },
  { command: "operate_closerefrigeration", label: "Fridge off", icon: "🔥" },
  { command: "operate_status", label: "Status query", icon: "📡" },
];

type CmdResult = { ok: boolean; error?: string; huaxinCode?: string; huaxinMsg?: string; cmd?: string };

export function RemoteControls({ imei }: { imei: string }) {
  const [pending, startTransition] = useTransition();
  const [results, setResults] = useState<CmdResult[]>([]);

  const send = (cmd: string, label: string) => {
    startTransition(async () => {
      const res = await sendMachineCommand(imei, cmd);
      const entry: CmdResult = { ...res, cmd: label };
      setResults((prev) => [entry, ...prev].slice(0, 5));
    });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {COMMANDS.map((c) => (
          <button
            key={c.command}
            disabled={pending}
            onClick={() => send(c.command, c.label)}
            className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-cocoa transition hover:bg-cream disabled:opacity-50"
          >
            <span className="mr-1">{c.icon}</span>
            {c.label}
          </button>
        ))}
      </div>
      {pending && <p className="mt-2 text-xs text-taupe">Sending command…</p>}
      {results.length > 0 && (
        <div className="mt-3 space-y-1 rounded-lg bg-cream/50 p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-taupe">Command log</div>
          {results.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span className={r.ok ? "text-sage" : "text-danger"}>{r.ok ? "✓" : "✗"}</span>
              <span className="font-semibold text-cocoa">{r.cmd}</span>
              <span className="text-taupe">
                Huaxin: {r.huaxinCode ?? "—"} / {r.huaxinMsg ?? r.error ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
