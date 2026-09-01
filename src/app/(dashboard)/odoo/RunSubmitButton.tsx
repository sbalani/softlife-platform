"use client";

import { useFormStatus } from "react-dom";

export function RunSubmitButton({ idle, pending, className }: { idle: string; pending: string; className: string }) {
  const status = useFormStatus();
  return <button disabled={status.pending} className={`${className} disabled:cursor-wait disabled:opacity-60`}>{status.pending ? pending : idle}</button>;
}
