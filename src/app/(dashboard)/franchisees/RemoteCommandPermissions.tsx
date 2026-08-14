"use client";

import { useState, useTransition } from "react";
import { FRANCHISEE_CONFIGURABLE_COMMANDS } from "@/lib/huaxin/remote-commands";
import { setFranchiseeRemoteCommands } from "./actions";

export function RemoteCommandPermissions({ tenantId, initialCommands }: { tenantId: string; initialCommands: string[] }) {
  const [commands, setCommands] = useState(initialCommands);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const toggle = (command: string) => setCommands((current) => current.includes(command) ? current.filter((item) => item !== command) : [...current, command]);
  const save = () => startTransition(async () => {
    const response = await setFranchiseeRemoteCommands(tenantId, commands);
    setResult(response.ok ? "Saved" : response.error ?? "Failed");
  });
  return (
    <div className="min-w-[320px]">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {FRANCHISEE_CONFIGURABLE_COMMANDS.map((item) => <label key={item.command} className="flex items-center gap-1 text-xs text-cocoa"><input type="checkbox" checked={commands.includes(item.command)} onChange={() => toggle(item.command)} />{item.label}</label>)}
      </div>
      <div className="mt-2 flex items-center gap-2"><button onClick={save} disabled={pending} className="rounded bg-cocoa px-2 py-1 text-[10px] font-bold text-white disabled:opacity-50">{pending ? "Saving..." : "Save controls"}</button>{result && <span className="text-[10px] text-taupe">{result}</span>}</div>
    </div>
  );
}
