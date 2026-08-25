import { FranchiseeIntakeForm } from "./FranchiseeIntakeForm";
import Link from "next/link";

export const metadata = { title: "New franchisee information | SoftLife" };

export default function FranchiseeIntakePage() {
  return (
    <main className="min-h-screen bg-[#f5efe7] px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.28em] text-[#c87954]">SoftLife</div>
          <h1 className="mt-3 font-display text-3xl font-bold text-[#4a3428] sm:text-4xl">New franchisee information</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#806f63]">Complete these basic details so our team can prepare the franchisee account.</p>
        </div>
        <section className="rounded-3xl border border-[#e0d6cb] bg-[#fffdfa] p-6 shadow-[0_18px_60px_rgba(74,52,40,0.08)] sm:p-8">
          <FranchiseeIntakeForm />
        </section>
        <p className="mt-5 text-center text-xs text-[#806f63]">Al enviar tus datos, consulta nuestra <Link href="/privacy" className="font-bold text-[#c87954] hover:underline">política de privacidad</Link>.</p>
      </div>
    </main>
  );
}
