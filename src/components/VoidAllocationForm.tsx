"use client";

import { useActionState, useState } from "react";
import { voidAllocation, type InventoryActionResult } from "@/app/actions/inventory-reconciliation";

export function VoidAllocationForm({ allocationId }: { allocationId: string }) {
  const [result, action, pending] = useActionState<InventoryActionResult | null, FormData>(voidAllocation, null);
  const [clientUuid] = useState(() => crypto.randomUUID());
  return <form action={action} className="flex items-center justify-end gap-2"><input type="hidden" name="client_uuid" value={clientUuid} /><input type="hidden" name="allocation_id" value={allocationId} /><input name="reason" required placeholder="Void reason" className="w-36 rounded border border-line px-2 py-1 text-xs" /><button disabled={pending || result?.ok} className="text-xs font-bold text-danger disabled:opacity-50">{pending ? "Voiding..." : "Void"}</button>{result?.ok && <span className="text-xs text-sage">Reversed</span>}{result && !result.ok && <span className="max-w-40 text-xs text-danger">{result.error}</span>}</form>;
}
