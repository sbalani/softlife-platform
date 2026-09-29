"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { Locale } from "@/lib/i18n/locale";
import {
  ACCEPTANCE_DECLARATION,
  ACCEPT_BUTTON_LABEL,
  AUTHORITY_DECLARATION,
  EVIDENCE_DECLARATION,
  FRANCHISEE_CONTRACT_VERSION,
  renderFranchiseeContract,
  type ContractPartyValues,
} from "@/lib/franchisee-onboarding-contract";
import { submitFranchiseeIntake, type FranchiseeIntakeResult } from "./actions";

const input = "mt-1.5 w-full rounded-xl border border-[#d8cfc5] bg-white px-4 py-3 text-base text-[#4a3428] outline-none transition focus:border-[#c87954] focus:ring-2 focus:ring-[#c87954]/15";
const label = "block text-sm font-semibold text-[#4a3428]";

function valuesFromForm(form: HTMLFormElement): Partial<ContractPartyValues> {
  const data = new FormData(form);
  const field = (name: string) => String(data.get(name) ?? "");
  const bankDetailsDeferred = data.get("bank_details_deferred") === "yes";
  return {
    representativeName: field("representative_name"),
    representativeEmail: field("representative_email"),
    representativePhone: field("representative_phone"),
    representativeTitle: field("representative_title"),
    legalEntityName: field("legal_entity_name"),
    taxId: field("tax_id"),
    registeredAddress: field("registered_address"),
    tradeName: field("trade_name") || null,
    installationAddress: field("installation_address"),
    accountHolderName: bankDetailsDeferred ? null : field("account_holder_name"),
    iban: bankDetailsDeferred ? null : field("iban").toUpperCase(),
    bicSwift: bankDetailsDeferred ? null : field("bic_swift").toUpperCase() || null,
    bankDetailsDeferred,
  };
}

export function FranchiseeIntakeForm({ locale }: { locale: Locale }) {
  const [result, action, pending] = useActionState<FranchiseeIntakeResult | null, FormData>(submitFranchiseeIntake, null);
  const [preview, setPreview] = useState<Partial<ContractPartyValues>>({});
  const es = locale === "es";
  const contract = renderFranchiseeContract(preview);
  const bankDetailsDeferred = preview.bankDetailsDeferred === true;

  if (result?.ok && result.downloadUrl) return (
    <div className="rounded-2xl border border-[#8cae93]/40 bg-[#8cae93]/10 p-6 text-center">
      <h2 className="font-display text-2xl font-bold text-[#3f6547]">{es ? "Contrato aceptado" : "Contract accepted"}</h2>
      <p className="mt-2 text-sm leading-6 text-[#4f6554]">{es ? "La aceptación y su PDF de evidencia se han guardado correctamente." : "The acceptance and its evidence PDF were stored successfully."}</p>
      <p className="mt-2 font-mono text-xs text-[#5f6f61]">ID: {result.acceptanceId}</p>
      <a href={result.downloadUrl} className="mt-5 inline-flex rounded-xl bg-[#3f6547] px-5 py-3 text-sm font-bold text-white hover:bg-[#315038]">{es ? "Descargar el PDF confirmado" : "Download confirmed PDF"}</a>
      <p className="mt-3 text-xs text-[#5f6f61]">{es ? "Descárgalo ahora y conserva esta copia. El enlace contiene un token privado." : "Download it now and retain your copy. The link contains a private token."}</p>
    </div>
  );

  return (
    <form action={action} onInput={(event) => setPreview(valuesFromForm(event.currentTarget))} className="space-y-8">
      <div className="absolute -left-[10000px]" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>

      <section>
        <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c87954]">01 · {es ? "Representación" : "Representative"}</p><h2 className="mt-1 font-display text-xl font-bold text-[#4a3428]">{es ? "Firmante y entidad gestora" : "Signer and manager entity"}</h2></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>{es ? "Nombre legal del representante *" : "Representative legal name *"}<input name="representative_name" required maxLength={150} autoComplete="name" className={input} /></label>
          <label className={label}>{es ? "Cargo o capacidad *" : "Title / capacity *"}<input name="representative_title" required maxLength={150} autoComplete="organization-title" className={input} /></label>
          <label className={label}>Email *<input name="representative_email" type="email" required maxLength={254} autoComplete="email" className={input} /></label>
          <label className={label}>{es ? "Teléfono *" : "Phone *"}<input name="representative_phone" required maxLength={40} inputMode="tel" autoComplete="tel" placeholder="+34 600 000 000" className={input} /></label>
          <label className={`${label} sm:col-span-2`}>{es ? "Nombre legal de empresa o autónomo *" : "Company / autónomo legal name *"}<input name="legal_entity_name" required maxLength={150} autoComplete="organization" className={input} /></label>
          <label className={label}>NIF / CIF *<input name="tax_id" required maxLength={50} className={`${input} uppercase`} /></label>
          <label className={label}>{es ? "Nombre comercial (opcional)" : "Trade name (optional)"}<input name="trade_name" maxLength={150} className={input} /></label>
          <label className={`${label} sm:col-span-2`}>{es ? "Domicilio registrado completo *" : "Full registered address *"}<textarea name="registered_address" required maxLength={500} rows={2} autoComplete="street-address" className={input} /></label>
        </div>
      </section>

      <section className="border-t border-[#e0d6cb] pt-7">
        <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c87954]">02 · {es ? "Instalación" : "Installation"}</p><h2 className="mt-1 font-display text-xl font-bold text-[#4a3428]">{es ? "Emplazamiento propuesto" : "Proposed location"}</h2></div>
        <label className={label}>{es ? "Dirección exacta de instalación propuesta *" : "Exact proposed installation address *"}<textarea name="installation_address" required maxLength={500} rows={3} className={input} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[#806f63]">{es ? "Esta dirección quedará vinculada en el Anexo I. El modelo y el IMEI se asignarán después en un acta firmada." : "This address will be binding in Annex I. Model and IMEI will be assigned later in a signed record."}</span></label>
      </section>

      <section className="border-t border-[#e0d6cb] pt-7">
        <div className="mb-4"><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c87954]">03 · {es ? "Pagos" : "Payments"}</p><h2 className="mt-1 font-display text-xl font-bold text-[#4a3428]">{es ? "Cuenta bancaria (opcional ahora)" : "Bank account (optional now)"}</h2><p className="mt-2 text-xs leading-5 text-[#806f63]">{es ? "Toda participación se paga solo por transferencia o ingreso bancario; nunca en efectivo." : "All revenue share is paid only by bank transfer or deposit; never in cash."}</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>{es ? "Titular de la cuenta" : "Account holder"}<input name="account_holder_name" required={!bankDetailsDeferred} disabled={bankDetailsDeferred} maxLength={150} autoComplete="name" className={`${input} disabled:bg-[#eee8e1] disabled:text-[#998b80]`} /></label>
          <label className={label}>IBAN<input name="iban" required={!bankDetailsDeferred} disabled={bankDetailsDeferred} maxLength={34} spellCheck={false} autoComplete="off" className={`${input} font-mono uppercase disabled:bg-[#eee8e1] disabled:text-[#998b80]`} /></label>
          <label className={label}>BIC / SWIFT ({es ? "opcional" : "optional"})<input name="bic_swift" disabled={bankDetailsDeferred} maxLength={11} spellCheck={false} autoComplete="off" className={`${input} font-mono uppercase disabled:bg-[#eee8e1] disabled:text-[#998b80]`} /></label>
          <label className="flex cursor-pointer gap-3 rounded-2xl border-2 border-[#c87954] bg-[#c87954]/10 p-4 text-sm leading-5 text-[#4a3428] sm:col-span-2"><input type="checkbox" name="bank_details_deferred" value="yes" className="mt-1 accent-[#c87954]" /><span><strong className="block">{es ? "Proporcionar los datos bancarios más adelante" : "Provide bank details later"}</strong><span className="mt-1 block font-semibold text-[#8a3f29]">{es ? "El alta y la firma pueden continuar, pero SOFTLIFE no podrá realizar ningún pago de participación hasta recibir datos bancarios completos y válidos." : "Onboarding and signing may proceed, but SOFTLIFE cannot make any revenue-share payment until complete valid bank details are provided."}</span></span></label>
        </div>
      </section>

      <section className="border-t border-[#e0d6cb] pt-7">
        <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c87954]">04 · {es ? "Revisión" : "Review"}</p><h2 className="mt-1 font-display text-xl font-bold text-[#4a3428]">{es ? "Contrato completo en español" : "Complete Spanish contract"}</h2></div><span className="rounded-full bg-[#4a3428]/7 px-3 py-1 font-mono text-[10px] font-bold text-[#4a3428]">{FRANCHISEE_CONTRACT_VERSION}</span></div>
        <p className="mt-2 text-xs leading-5 text-[#806f63]">{es ? "El texto español es el único contrato vinculante. Los datos introducidos se reflejan aquí en directo; la fecha definitiva se genera en el servidor." : "The Spanish text is the only binding contract. Entered data is reflected live; the final date is generated by the server."}</p>
        <article lang="es" tabIndex={0} className="mt-4 h-[32rem] overflow-y-auto rounded-2xl border border-[#cfc3b7] bg-white p-5 text-sm leading-6 text-[#4a3428] shadow-inner sm:p-7">
          <h3 className="text-center font-display text-lg font-bold">{contract.title}</h3>
          {contract.preamble.map((paragraph) => <p key={paragraph} className="mt-4">{paragraph}</p>)}
          {contract.sections.map((section) => <section key={section.title} className="mt-6"><h4 className="font-bold text-[#ad6041]">{section.title}</h4>{section.paragraphs.map((paragraph) => <p key={paragraph} className="mt-3">{paragraph}</p>)}</section>)}
        </article>
      </section>

      <section className="space-y-3 border-t border-[#e0d6cb] pt-7">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c87954]">05 · {es ? "Aceptación electrónica" : "Electronic acceptance"}</p>
        <label className="flex gap-3 rounded-xl border border-[#d8cfc5] bg-white p-4 text-sm leading-5 text-[#4a3428]"><input type="checkbox" name="accepted_terms" value="yes" required className="mt-1 accent-[#c87954]" /><span>{ACCEPTANCE_DECLARATION}</span></label>
        <label className="flex gap-3 rounded-xl border border-[#d8cfc5] bg-white p-4 text-sm leading-5 text-[#4a3428]"><input type="checkbox" name="accepted_authority" value="yes" required className="mt-1 accent-[#c87954]" /><span>{AUTHORITY_DECLARATION}</span></label>
        <label className="flex gap-3 rounded-xl border border-[#d8cfc5] bg-white p-4 text-sm leading-5 text-[#4a3428]"><input type="checkbox" name="accepted_evidence" value="yes" required className="mt-1 accent-[#c87954]" /><span>{EVIDENCE_DECLARATION}</span></label>
        <label className={`${label} pt-2`}>{es ? "Firma escrita: repite exactamente el nombre legal del representante *" : "Typed signature: exactly repeat the representative legal name *"}<input name="typed_signature" required maxLength={150} autoComplete="off" className={`${input} font-display text-lg`} /></label>
        <aside className="rounded-xl bg-[#f5efe7] p-4 text-xs leading-5 text-[#6c5b50]">{es ? "Privacidad: recogemos los datos contractuales y evidencias de auditoría (incluida una huella HMAC de IP, no la IP en claro) para gestionar y acreditar la relación. Esto no es una casilla de consentimiento GDPR. Consulta la" : "Privacy: we collect contract and audit evidence (including an HMAC IP fingerprint, not the raw IP) to manage and evidence the relationship. This is not a GDPR consent checkbox. See the"} <Link href={es ? "/privacy" : "/privacy/en"} target="_blank" className="font-bold text-[#ad6041] underline">{es ? "política de privacidad" : "privacy policy"}</Link>.</aside>
      </section>

      {result && !result.ok && <p role="alert" aria-live="polite" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{result.error}</p>}
      <button type="submit" disabled={pending} className="w-full rounded-xl bg-[#c87954] px-5 py-4 text-base font-bold text-white transition hover:bg-[#ad6041] disabled:cursor-wait disabled:opacity-60">{pending ? (es ? "Generando y guardando el contrato..." : "Generating and storing contract...") : ACCEPT_BUTTON_LABEL}</button>
      <p className="text-center text-xs leading-5 text-[#806f63]">{es ? "Esto registra una aceptación electrónica con evidencia, no una firma electrónica cualificada ni PAdES." : "This records electronic acceptance with supporting evidence, not a qualified electronic signature or PAdES."}</p>
    </form>
  );
}
