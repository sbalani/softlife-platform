"use client";

import { useState, useTransition } from "react";
import type { AccessibleMachine } from "@/lib/data/accessible-machines";
import type { HuaxinRemoteCommand } from "@/lib/huaxin/remote-commands";
import { sendMachineCommand } from "../machines/[imei]/actions";

export function RemoteControlPanel({ machines, commands }: { machines: AccessibleMachine[]; commands: HuaxinRemoteCommand[] }) {
  const [imei, setImei] = useState(machines[0]?.device_imei ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  const send = (command: string, label: string) => {
    if (!imei) return;
    if (!confirm(`Send “${label}” to ${imei}?`)) return;
    setResult(null);
    startTransition(async () => {
      const response = await sendMachineCommand(imei, command);
      setResult(response.ok ? `${label}: ${response.huaxinMsg ?? "success"}` : response.error ?? "Command failed");
    });
  };

  if (!machines.length) {
    return <p className="rounded-2xl border border-line bg-white p-5 text-sm text-taupe">No machines are assigned to your account.</p>;
  }

  return (
    <div className="space-y-4">
      <label className="block rounded-2xl border border-line bg-white p-4">
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-taupe">Machine</span>
        <select value={imei} onChange={(e) => setImei(e.target.value)} className="w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-cocoa focus:border-terracotta focus:outline-none">
          {machines.map((machine) => (
            <option key={machine.id} value={machine.device_imei}>
              {machine.display_name || machine.name} · {machine.device_imei}{machine.is_online ? " · Online" : " · Offline"}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-1 gap-3">
        {commands.map((item) => (
          <button key={item.command} onClick={() => send(item.command, item.label)} disabled={pending} className="rounded-2xl border border-line bg-white p-4 text-left transition active:scale-[.99] disabled:opacity-50">
            <span className="block text-base font-bold text-cocoa">{item.label}</span>
            <span className="mt-0.5 block text-xs text-taupe">{item.note}</span>
          </button>
        ))}
      </div>
      {!commands.length && <p className="rounded-2xl border border-line bg-white p-5 text-sm text-taupe">No remote controls are enabled for your franchise account.</p>}

      {pending && <p className="text-center text-sm text-taupe">Sending command…</p>}
      {result && <p className="rounded-xl bg-cream p-3 text-center text-sm font-semibold text-cocoa">{result}</p>}
    </div>
  );
}
