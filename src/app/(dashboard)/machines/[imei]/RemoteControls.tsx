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
];

export function RemoteControls({ imei }: { imei: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; error?: string; cmd?: string } | null>(null);

  const send = (cmd: string, label: string) => {
    startTransition(async () => {
      const res = await sendMachineCommand(imei, cmd);
      setResult({ ...res, cmd: label });
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
      {result && (
        <p className={`mt-2 text-xs font-semibold ${result.ok ? "text-sage" : "text-danger"}`}>
          {result.ok ? `${result.cmd} — sent.` : `${result.cmd} — ${result.error}`}
        </p>
      )}
    </div>
  );
}
