"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot">("login");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "forgot") {
        const response = await fetch("/api/softlife/auth/forgot-password", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }),
        });
        if (!response.ok) {
          setError("Password recovery is temporarily unavailable. Please try again later.");
          return;
        }
        setMessage("If an account exists for that email, a password reset link has been sent.");
        return;
      }
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError || !data.session || !data.user) {
        setError(authError?.code === "invalid_credentials" || authError?.message === "Invalid login credentials" ? "Incorrect email or password." : authError?.message ?? "Unable to sign in. Please try again.");
        return;
      }
      const next = searchParams.get("next");
      let destination = "/dashboard";
      if (next) {
        try {
        const resolved = new URL(next, location.origin);
        if (resolved.origin === location.origin) destination = `${resolved.pathname}${resolved.search}${resolved.hash}`;
        } catch {
          destination = "/dashboard";
        }
      }
      router.push(destination);
      router.refresh();
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className={label}>Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
          autoComplete="email"
          autoFocus
        />
      </label>
      {mode === "login" && <label className="block">
        <span className={label}>Password</span>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={input}
          autoComplete="current-password"
        />
      </label>}
      {error && <p role="alert" aria-live="polite" className="text-sm text-danger">{error}</p>}
      {message && <p role="status" aria-live="polite" className="text-sm text-sage">{message}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
      >
        {pending ? mode === "forgot" ? "Sending…" : "Signing in…" : mode === "forgot" ? "Send password reset" : "Sign in"}
      </button>
      <button type="button" disabled={pending} onClick={() => { setMode((current) => current === "login" ? "forgot" : "login"); setError(null); setMessage(null); }} className="w-full text-xs font-semibold text-terracotta hover:underline disabled:opacity-60">
        {mode === "forgot" ? "Back to sign in" : "Forgot your password?"}
      </button>
    </form>
  );
}
