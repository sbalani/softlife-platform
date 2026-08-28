"use client";

import { useTransition } from "react";
import { setLocale } from "@/app/actions/locale";
import type { Locale } from "@/lib/i18n/locale";

export function LanguageSelector({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-taupe">
      {!compact && <span>{locale === "es" ? "Idioma" : "Language"}</span>}
      <select
        aria-label={locale === "es" ? "Idioma" : "Language"}
        value={locale}
        disabled={pending}
        onChange={(event) => startTransition(async () => { await setLocale(event.target.value as Locale); })}
        className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs font-bold text-cocoa focus:border-terracotta focus:outline-none disabled:opacity-50"
      >
        <option value="en">EN</option>
        <option value="es">ES</option>
      </select>
    </label>
  );
}
