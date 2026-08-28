import Link from "next/link";
import type { Locale } from "@/lib/i18n/locale";

const LABELS = {
  en: { company: "company/autónomo name", tax: "NIF/CIF", bank: "bank account", title: "Payout details incomplete", text: "SoftLife cannot pay this account until the required payout details are complete.", action: "Complete details" },
  es: { company: "nombre de empresa/autónomo", tax: "NIF/CIF", bank: "cuenta bancaria", title: "Datos de pago incompletos", text: "SoftLife no puede pagar esta cuenta hasta que se completen los datos obligatorios.", action: "Completar datos" },
} as const;

export function PayoutReadinessAlert({ missing, locale }: { missing: ("company" | "tax" | "bank")[]; locale: Locale }) {
  const text = LABELS[locale];
  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-cocoa">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-warning font-bold text-white">!</span>
      <div className="min-w-0 flex-1"><strong>{text.title}</strong><div className="text-xs text-taupe">{text.text} {missing.map((field) => text[field]).join(", ")}.</div></div>
      <Link href="/account" className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white">{text.action}</Link>
    </div>
  );
}
