"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  ACCEPTANCE_DECLARATION,
  AUTHORITY_DECLARATION,
  EVIDENCE_DECLARATION,
  FRANCHISEE_CONTRACT_VERSION,
  renderFranchiseeContract,
  type ContractPartyValues,
} from "@/lib/franchisee-onboarding-contract";
import { FRANCHISEE_CONTRACT_ACCEPTANCE_DEADLINE } from "@/lib/franchisee-contract-acceptance";
import { acceptCurrentContract, type ContractAcceptanceResult } from "./actions";

const input = "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[10px] font-bold uppercase tracking-wide text-taupe";

export function ContractAcceptanceForm({
  party,
  acceptance,
  canAccept,
  needsInstallationAddress,
}: {
  party: ContractPartyValues;
  acceptance: { id: string; accepted_at: string } | null;
  canAccept: boolean;
  needsInstallationAddress: boolean;
}) {
  const [result, action, pending] = useActionState<ContractAcceptanceResult | null, FormData>(acceptCurrentContract, null);
  const [title, setTitle] = useState(party.representativeTitle);
  const [phone, setPhone] = useState(party.representativePhone);
  const [installationAddress, setInstallationAddress] = useState(party.installationAddress);
  const contract = renderFranchiseeContract({ ...party, representativeTitle: title, representativePhone: phone, installationAddress }, acceptance?.accepted_at);
  const downloadUrl = result?.downloadUrl ?? (acceptance ? `/account/contract/${acceptance.id}/pdf` : null);
  const contractText = (
    <article className="max-h-[42rem] overflow-y-auto rounded-xl border border-line bg-cream/30 p-5 text-sm leading-6 text-cocoa" aria-label="Texto completo del contrato en español">
      <h3 className="font-display text-xl font-bold">{contract.title}</h3>
      {contract.preamble.map((paragraph) => <p key={paragraph} className="mt-3">{paragraph}</p>)}
      {contract.sections.map((section) => <section key={section.title} className="mt-5"><h4 className="font-bold text-terracotta">{section.title}</h4>{section.paragraphs.map((paragraph) => <p key={paragraph} className="mt-2">{paragraph}</p>)}</section>)}
    </article>
  );

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-cocoa">Contrato vigente</h2>
          <p className="mt-1 text-xs text-taupe">Versión {FRANCHISEE_CONTRACT_VERSION} · Fecha límite de aceptación: 14 de noviembre de 2026.</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${acceptance || result?.ok ? "bg-sage/15 text-sage" : "bg-warning/15 text-warning"}`}>
          {acceptance || result?.ok ? "Aceptado" : "Pendiente"}
        </span>
      </div>

      {downloadUrl && (
        <div className="mt-4 rounded-xl border border-sage/30 bg-sage/10 p-4 text-sm text-cocoa">
          <p className="font-bold">La aceptación de este contrato está registrada.</p>
          {acceptance?.accepted_at && <p className="mt-1 text-xs text-taupe">Aceptado el {new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" }).format(new Date(acceptance.accepted_at))}.</p>}
          <Link href={downloadUrl} className="mt-3 inline-block rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white">Descargar PDF verificado</Link>
        </div>
      )}
      {(acceptance || result?.ok) && <div className="mt-5">{contractText}</div>}

      {!acceptance && !result?.ok && (
        <>
          {!canAccept && <p className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-cocoa">Completa y guarda arriba el nombre legal, NIF/CIF, dirección postal y cuenta bancaria. Tu perfil también debe incluir nombre completo y email.</p>}
          <form action={action} className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label><span className={label}>Cargo o capacidad del firmante</span><input name="representative_title" required maxLength={150} value={title} onChange={(event) => setTitle(event.target.value)} className={input} /></label>
              <label><span className={label}>Teléfono del firmante</span><input name="representative_phone" required maxLength={40} inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className={input} /></label>
              {needsInstallationAddress && <label className="sm:col-span-2"><span className={label}>Dirección exacta de instalación</span><input name="installation_address" required maxLength={500} value={installationAddress} onChange={(event) => setInstallationAddress(event.target.value)} className={input} /></label>}
            </div>

            {contractText}

            <div className="space-y-3">
              <label className="flex gap-3 rounded-xl border border-line p-4 text-sm"><input type="checkbox" name="accepted_terms" value="yes" required className="mt-1 accent-[#c87954]" /><span>{ACCEPTANCE_DECLARATION}</span></label>
              <label className="flex gap-3 rounded-xl border border-line p-4 text-sm"><input type="checkbox" name="accepted_authority" value="yes" required className="mt-1 accent-[#c87954]" /><span>{AUTHORITY_DECLARATION}</span></label>
              <label className="flex gap-3 rounded-xl border border-line p-4 text-sm"><input type="checkbox" name="accepted_evidence" value="yes" required className="mt-1 accent-[#c87954]" /><span>{EVIDENCE_DECLARATION}</span></label>
            </div>
            <label><span className={label}>Firma escrita: nombre completo del perfil</span><input name="typed_signature" required maxLength={150} autoComplete="name" className={input} /></label>
            <div className="flex flex-wrap items-center gap-3">
              <button disabled={pending || !canAccept} className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending ? "Registrando..." : "Aceptar y firmar contrato"}</button>
              {result && !result.ok && <span className="text-xs font-semibold text-danger">{result.error}</span>}
            </div>
          </form>
        </>
      )}
      <p className="mt-4 text-xs leading-5 text-taupe">La aceptación genera evidencia técnica y un PDF privado verificable. Documenta una aceptación electrónica ordinaria; no constituye firma electrónica cualificada ni PAdES.</p>
      <p className="mt-1 text-xs text-taupe">Fecha límite: {FRANCHISEE_CONTRACT_ACCEPTANCE_DEADLINE}.</p>
    </section>
  );
}
