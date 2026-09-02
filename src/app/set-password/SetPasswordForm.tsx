"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";

export function SetPasswordForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    const flowType = hash.get("type");
    const linkError = hash.get("error") || hash.get("error_code") || hash.get("error_description") || query.get("error") || query.get("error_code") || query.get("error_description");
    if (window.location.hash || linkError) window.history.replaceState(window.history.state, "", window.location.pathname);
    (async () => {
      if (linkError || !accessToken || !refreshToken || (flowType !== "invite" && flowType !== "recovery")) {
        setError("This password link is invalid or expired.");
        return;
      }
      const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (sessionError) { setError("This password link is invalid or expired."); return; }
      setRecovery(flowType === "recovery");
      setReady(true);
    })();
  }, []);

  const submit = () => {
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    startTransition(async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) return setError(updateError.message);
      if (recovery) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) return setError(signOutError.message);
        setSaved(true);
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    });
  };

  if (saved) return <div className="space-y-3"><p className="text-sm text-sage">Password updated successfully.</p><Link href="/login" className="text-sm font-semibold text-terracotta hover:underline">Return to sign in</Link></div>;

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
      <button onClick={submit} disabled={pending || !ready} className="w-full rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60">
        {!ready && !error ? "Validating link…" : pending ? "Saving…" : "Set password"}
      </button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
