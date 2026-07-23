"use client";

import { useState, useTransition } from "react";
import { setTimezone } from "./timezone-action";
import { COMMON_TZ } from "@/lib/dates";

export function TimezoneSelector({ current }: { current: string }) {
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(current);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          startTransition(() => setTimezone(e.target.value));
        }}
        disabled={pending}
        className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none disabled:opacity-60"
      >
        {[...new Set([current, ...COMMON_TZ])].map((tz) => (
          <option key={tz} value={tz}>{tz}</option>
        ))}
      </select>
      {pending && <span className="text-xs text-taupe">Saving…</span>}
    </div>
  );
}
