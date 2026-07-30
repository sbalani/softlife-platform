"use client";

import { useTransition } from "react";
import { resolveAlert } from "./actions";

export function ResolveAlertButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return <button disabled={pending} onClick={() => startTransition(() => resolveAlert(id))} className="text-xs font-bold text-sage disabled:opacity-50">{pending ? "Resolving..." : "Resolve"}</button>;
}
