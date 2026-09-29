import { FranchiseeIntakeForm } from "./FranchiseeIntakeForm";
import Link from "next/link";
import { getRequestLocale } from "@/lib/i18n/request-locale";
import { LanguageSelector } from "@/components/LanguageSelector";

export const metadata = { title: "Customer onboarding and contract | SoftLife" };

export default async function FranchiseeIntakePage() {
  const locale = await getRequestLocale();
  const es = locale === "es";
  return (
    <main className="min-h-screen bg-[#f5efe7] px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center" lang={locale}>
          <div className="mb-3 flex justify-end"><LanguageSelector locale={locale} /></div>
          <div className="text-xs font-bold uppercase tracking-[0.28em] text-[#c87954]">SoftLife</div>
          <h1 className="mt-3 font-display text-3xl font-bold text-[#4a3428] sm:text-4xl">{es ? "Alta y aceptación del contrato" : "Onboarding and contract acceptance"}</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#806f63]">{es ? "Completa los datos y revisa íntegramente la oferta contractual antes de aceptarla. SOFTLIFE asignará la modalidad más adelante." : "Complete the details and review the complete contractual offer before accepting it. SOFTLIFE will assign the modality later. The binding contract is Spanish."}</p>
        </div>
        <section className="rounded-3xl border border-[#e0d6cb] bg-[#fffdfa] p-6 shadow-[0_18px_60px_rgba(74,52,40,0.08)] sm:p-8">
          <FranchiseeIntakeForm locale={locale} />
        </section>
        <p className="mt-5 text-center text-xs text-[#806f63]">{es ? "Información sobre el tratamiento de datos en nuestra " : "Data-processing information is in our "}<Link href={es ? "/privacy" : "/privacy/en"} className="font-bold text-[#c87954] hover:underline">{es ? "política de privacidad" : "privacy policy"}</Link>.</p>
      </div>
    </main>
  );
}
