import { Suspense } from "react";
import Link from "next/link";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-terracotta text-white font-display text-xl font-bold">
            S
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-bold text-cocoa">SoftLife</div>
            <div className="text-[11px] uppercase tracking-wider text-taupe">Platform</div>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
        <div className="mt-6 border-t border-line pt-4 text-center">
          <Link href="/privacy" className="text-xs font-semibold text-taupe hover:text-terracotta hover:underline">Política de privacidad</Link>
        </div>
      </div>
    </div>
  );
}
