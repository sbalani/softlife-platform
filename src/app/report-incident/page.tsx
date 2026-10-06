import type { Metadata } from "next";
import Link from "next/link";
import { LanguageSelector } from "@/components/LanguageSelector";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { publicReportLocationPreset } from "@/lib/public-reporting";
import { listPublicReportMachines } from "@/lib/public-reporting-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { ReportIncidentForm } from "./ReportIncidentForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report a machine issue | SoftLife", robots: { index: false, follow: false } };

export default async function ReportIncidentPage({ searchParams }: { searchParams: Promise<{ location?: string | string[] }> }) {
  const [locale, query] = await Promise.all([getRequestLocale(), searchParams]);
  const es = locale === "es";
  let machines: { id: string; label: string }[] = [];
  if (isSupabaseConfigured()) {
    try { machines = await listPublicReportMachines(locale); } catch { /* The client retries while the form remains open. */ }
  }
  const initialMachineId = publicReportLocationPreset(query.location, machines.map((machine) => machine.id));
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#f5ddd0_0,_transparent_36%),linear-gradient(145deg,#fbf7f3_30%,#edf5ef)] px-4 py-10 sm:py-16"><div className="mx-auto max-w-2xl" lang={locale}><div className="mb-5 flex justify-end"><LanguageSelector locale={locale} /></div><header className="mb-8"><p className="text-xs font-bold uppercase tracking-[0.24em] text-terracotta">{es ? "Soporte SoftLife" : "SoftLife support"}</p><h1 className="mt-2 font-display text-4xl font-bold leading-tight text-cocoa sm:text-5xl">{es ? "Cuéntanos qué ha ocurrido." : "Tell us what happened."}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-taupe sm:text-base">{es ? "Selecciona la ubicación de la máquina, indícanos cómo contactar contigo y describe la incidencia. Los archivos se guardan directamente en un espacio privado." : "Choose the machine location, share how we can reach you, and describe the issue. Evidence goes directly to private storage."}</p></header><ReportIncidentForm machines={machines} locale={locale} initialMachineId={initialMachineId} /><p className="mt-6 text-center text-xs text-taupe">{es ? "No incluyas datos de tarjetas de pago ni otra información sensible. Consulta nuestra " : "Do not include payment card details or other sensitive information. Read our "}<Link href={es ? "/privacy" : "/privacy/en"} className="font-semibold text-terracotta underline">{es ? "política de privacidad" : "privacy policy"}</Link>.</p></div></main>;
}
