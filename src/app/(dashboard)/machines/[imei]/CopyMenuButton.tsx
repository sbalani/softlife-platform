"use client";

import { useActionState, useState } from "react";
import { copyMenuToMachines, type CopyMenuResult } from "./actions";

export function CopyMenuButton({ sourceImei, machines }: { sourceImei: string; machines: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [res, action, pending] = useActionState<CopyMenuResult | null, FormData>(copyMenuToMachines, null);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-bold text-cocoa hover:bg-cream"
      >
        Copy this menu to other machines
      </button>
      {open && (
        <form action={action} className="mt-2 max-w-xl rounded-lg border border-line bg-cream/40 p-3">
          <input type="hidden" name="source_imei" value={sourceImei} />
          <p className="mb-2 text-[11px] text-taupe">
            Creates a draft on each machine selected — nothing pushes until it&apos;s confirmed there.
          </p>
          {machines.length === 0 ? (
            <p className="text-xs text-taupe">No other machines to copy to.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {machines.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-white px-2 py-1 text-xs text-cocoa">
                  <input type="checkbox" name="target_machine_id" value={m.id} className="accent-terracotta" />
                  {m.name}
                </label>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={pending || machines.length === 0}
              className="rounded bg-terracotta px-3 py-1.5 text-xs font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
            >
              {pending ? "Copying…" : "Copy menu"}
            </button>
            {res && (
              <span className={`text-xs font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>
                {res.ok ? `Copied to ${res.copiedTo} machine(s).` : res.error}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
