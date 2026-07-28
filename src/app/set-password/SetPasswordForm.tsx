"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";

export function SetPasswordForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    startTransition(async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) return setError(updateError.message);
      router.replace("/dashboard");
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">New password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-taupe">Confirm password</span>
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} className={input} />
      </label>
      <button onClick={submit} disabled={pending} className="w-full rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60">
        {pending ? "Saving…" : "Set password"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
