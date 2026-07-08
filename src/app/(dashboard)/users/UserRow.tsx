"use client";

import { useState, useTransition } from "react";
import { deleteUser, setUserRole } from "./actions";

export type UserRowData = { id: string; email: string | null; full_name: string | null; role: "admin" | "operator"; isSelf: boolean };

export function UserRow({ user }: { user: UserRowData }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggleRole = () => {
    setError(null);
    startTransition(async () => {
      const res = await setUserRole(user.id, user.role === "admin" ? "operator" : "admin");
      if (!res.ok) setError(res.error ?? "Failed");
    });
  };

  const remove = () => {
    if (!confirm(`Remove ${user.email ?? "this user"}? This can't be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteUser(user.id);
      if (!res.ok) setError(res.error ?? "Failed");
    });
  };

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3 font-semibold text-cocoa">{user.full_name ?? "—"}</td>
      <td className="px-4 py-3 text-taupe">{user.email ?? "—"}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${user.role === "admin" ? "bg-terracotta/15 text-terracotta" : "bg-sage/15 text-sage"}`}>
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        {user.isSelf ? (
          <span className="text-xs text-taupe">You</span>
        ) : (
          <div className="flex items-center justify-end gap-3">
            <button onClick={toggleRole} disabled={pending} className="text-xs font-semibold text-cocoa hover:text-terracotta disabled:opacity-50">
              Make {user.role === "admin" ? "operator" : "admin"}
            </button>
            <button onClick={remove} disabled={pending} className="text-xs font-semibold text-danger hover:underline disabled:opacity-50">
              Remove
            </button>
          </div>
        )}
        {error && <div className="mt-1 text-[11px] text-danger">{error}</div>}
      </td>
    </tr>
  );
}
