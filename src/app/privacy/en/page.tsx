import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy | SoftLife",
  description: "Information about how personal data is processed on the SoftLife platform.",
};

const section = "rounded-2xl border border-line bg-white p-5 sm:p-7";
const heading = "font-display text-xl font-bold text-cocoa";
const copy = "mt-3 space-y-3 text-sm leading-7 text-taupe";

export default function EnglishPrivacyPage() {
  return (
    <main lang="en" className="min-h-screen bg-cream px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <Link href="/login" className="inline-flex items-center gap-3" aria-label="Go to SoftLife login">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-terracotta font-display text-xl font-bold text-white">S</span>
            <span>
              <span className="block font-display text-lg font-bold leading-tight text-cocoa">SoftLife</span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-taupe">Platform</span>
            </span>
          </Link>
          <p className="mt-10 text-xs font-bold uppercase tracking-[0.22em] text-terracotta">Legal information</p>
          <h1 className="mt-2 font-display text-4xl font-bold text-cocoa sm:text-5xl">Privacy Policy</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-taupe">This policy explains how personal data is processed when you use the SoftLife platform, applications, and operational services.</p>
          <p className="mt-2 text-xs font-semibold text-taupe">Last updated: 25 August 2026</p>
          <nav aria-label="Language" className="mt-5 flex items-center gap-2 text-xs font-bold">
            <Link href="/privacy" lang="es" className="rounded-full border border-line bg-white px-3 py-1.5 text-cocoa hover:border-terracotta">Español</Link>
            <span aria-current="page" className="rounded-full bg-cocoa px-3 py-1.5 text-white">English</span>
          </nav>
        </header>

        <div className="space-y-4">
          <section className={section}>
            <h2 className={heading}>1. Data controller</h2>
            <div className={copy}>
              <p>The controller is SoftLife, the entity identified as such in the relevant contract or business relationship.</p>
              <p>For privacy enquiries and to exercise your rights, contact <a href="mailto:hola@softlife.es" className="font-bold text-terracotta hover:underline">hola@softlife.es</a>.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>2. Data we process</h2>
            <div className={copy}>
              <p>We may process identification and professional data, such as your name, email address, company, role, franchise, or relationship with SoftLife.</p>
              <p>We also process account and security data, access logs, technical identifiers, device information, and data required to provide support and protect the platform.</p>
              <p>When operational features are used, we may process service, cleaning, and refill reports, notes, photographs, voice recordings, transcripts, incidents, assignments, and machine-related activity. Machine telemetry does not normally identify a person by itself, but it may be associated with an account or professional action.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>3. Purposes and legal bases</h2>
            <div className={copy}>
              <p>We process data to create and administer accounts; authenticate users; provide the platform and its features; manage machines, inventory, incidents, and operations; answer enquiries; maintain security; prevent misuse; and retain evidence and audit trails.</p>
              <p>The applicable legal bases are the performance of a contract or steps taken before entering into a contract; compliance with legal obligations; and the legitimate interests of SoftLife and its partners in operating, protecting, and improving the service. Where required by law, we will request consent, which may be withdrawn without affecting the lawfulness of earlier processing.</p>
              <p>We do not make decisions producing legal effects based solely on automated processing. Some features may use automated or artificial-intelligence tools to transcribe, classify, or suggest information, subject to human review where appropriate.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>4. Retention</h2>
            <div className={copy}>
              <p>We retain data while the account or contractual relationship remains active and for as long as needed to provide the service. It may then be kept in restricted form for the periods required to meet legal obligations and address potential liabilities.</p>
              <p>Security logs, temporary files, and operational evidence are retained only for the period reasonably necessary for their purpose, unless they must be preserved in connection with an incident, claim, or legal obligation.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>5. Recipients and international transfers</h2>
            <div className={copy}>
              <p>Data may be shared with franchises, customers, employers, or partners where necessary to manage the machines and services assigned to them, according to their role and permissions.</p>
              <p>We also use technology providers acting as processors for hosting, databases, authentication, storage, notifications, support, communications, and artificial-intelligence features. Some providers may process data outside the European Economic Area. Where necessary, safeguards recognised by the GDPR will be used, such as adequacy decisions or standard contractual clauses.</p>
              <p>We may disclose information to public authorities where required by law.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>6. Your rights</h2>
            <div className={copy}>
              <p>You may request access, rectification, erasure, restriction, objection, and portability, and may withdraw consent where processing is based on consent.</p>
              <p>To exercise these rights, email <a href="mailto:hola@softlife.es" className="font-bold text-terracotta hover:underline">hola@softlife.es</a>, stating which right you wish to exercise and providing the information needed to verify your identity. We may request additional documentation if there are reasonable doubts about the requester&apos;s identity.</p>
              <p>You may also lodge a complaint with the <a href="https://www.aepd.es" target="_blank" rel="noreferrer" className="font-bold text-terracotta hover:underline">Spanish Data Protection Agency (AEPD)</a>.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>7. Security and user responsibilities</h2>
            <div className={copy}>
              <p>We apply reasonable technical and organisational measures to protect data against loss, alteration, and unauthorised access or disclosure. No system can guarantee absolute security.</p>
              <p>Users must keep their credentials confidential, use the platform only for authorised purposes, and avoid including unnecessary or special-category personal data in notes, photographs, audio, or other free-text fields.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>8. Children, cookies, and changes</h2>
            <div className={copy}>
              <p>The platform is intended for professional users and not for children under 14. We do not knowingly collect children&apos;s data through this service.</p>
              <p>We may use cookies or similar technologies that are strictly necessary to sign in, maintain sessions, and protect the platform. If non-essential technologies are introduced, we will provide the information and consent choices required by law.</p>
              <p>We may update this policy to reflect legal, technical, or service changes. The current version will always be available on this page and will show its latest update date.</p>
            </div>
          </section>
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-taupe">
          <span>© 2026 SoftLife</span>
          <Link href="/login" className="font-bold text-terracotta hover:underline">Return to login</Link>
        </footer>
      </div>
    </main>
  );
}
