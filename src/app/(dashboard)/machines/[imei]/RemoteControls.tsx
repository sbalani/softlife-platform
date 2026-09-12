"use client";

import { useState, useTransition } from "react";
import { HUAXIN_REMOTE_COMMANDS } from "@/lib/huaxin/remote-commands";
import { sendMachineCommand } from "./actions";

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
        {HUAXIN_REMOTE_COMMANDS.map((c) => (
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
          {results.map((r, i) => {
            const acceptedButUnconfirmed = !r.ok && r.huaxinCode === "200";
            return <div key={i} className="flex items-start gap-2 text-xs">
              <span className={r.ok ? "text-sage" : acceptedButUnconfirmed ? "text-warning" : "text-danger"}>{r.ok ? "✓" : acceptedButUnconfirmed ? "!" : "✗"}</span>
              <span className="font-semibold text-cocoa">{r.cmd}</span>
              <span className="text-taupe">
                {acceptedButUnconfirmed ? `Accepted by Huaxin, not confirmed: ${r.error}` : r.ok ? `Huaxin: ${r.huaxinCode ?? "—"} / ${r.huaxinMsg ?? "success"}` : r.error ?? `Huaxin: ${r.huaxinCode ?? "—"} / ${r.huaxinMsg ?? "failed"}`}
              </span>
            </div>;
          })}
        </div>
      )}
    </div>
  );
}
