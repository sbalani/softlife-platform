"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { SalesContextNote } from "@/lib/data/sales-context-notes";
import { createSalesContextNote, deleteSalesContextNote, type SalesNoteActionResult } from "./actions";

const initialState: SalesNoteActionResult = { ok: false };
const categoryLabels: Record<SalesContextNote["category"], string> = { event: "Local event", promotion: "Promotion", operations: "Operations", competition: "Competition", other: "Other" };

export function SalesNotesPanel({ notes, upcomingNotes, machines, today, selectedMachineId }: {
  notes: SalesContextNote[];
  upcomingNotes: SalesContextNote[];
  machines: { id: string; name: string; location: string | null }[];
  today: string;
  selectedMachineId?: string;
}) {
  const [state, action, pending] = useActionState(createSalesContextNote, initialState);
  const [deleting, startDeleting] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state.resetKey) formRef.current?.reset(); }, [state.resetKey]);
  const locationByMachine = new Map(machines.map((machine) => [machine.id, machine.location]));
  const displayedNotes = [...notes, ...upcomingNotes].sort((a, b) => a.salesDate.localeCompare(b.salesDate) || a.createdAt.localeCompare(b.createdAt));
  const latestEventDate = new Date(`${today}T12:00:00Z`);
  latestEventDate.setUTCDate(latestEventDate.getUTCDate() + 730);

  return <section className="mt-6 rounded-2xl border border-line bg-white p-5">
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
      <div>
        <h2 className="font-display text-lg font-bold text-cocoa">Events &amp; sales context</h2>
        <p className="mb-4 text-xs text-taupe">Record past or upcoming events that may affect sales. Events appear on the sales chart when their date enters the selected period.</p>
        <div className="space-y-2">
          {displayedNotes.map((note) => <article key={note.id} className="rounded-xl border border-line bg-cream/20 p-3">
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-taupe">
              <time>{note.salesDate}</time>{note.salesDate > today && <span className="rounded-full bg-terracotta/10 px-2 py-0.5 text-terracotta">Upcoming</span>}<span className="rounded-full bg-sage/10 px-2 py-0.5 text-sage">{categoryLabels[note.category]}</span>{note.machineName && <span>{note.machineName}{note.machineId && locationByMachine.get(note.machineId) ? ` · ${locationByMachine.get(note.machineId)}` : ""}</span>}
            </div>
            <p className="mt-1 text-sm text-cocoa">{note.body}</p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-taupe">
              <span>Added by {note.authorName}</span>
              <div className="flex items-center gap-3">
                {note.sourceUrl && <a href={note.sourceUrl} target="_blank" rel="noreferrer" className="font-bold text-terracotta">Source</a>}
                {note.canDelete && <button type="button" disabled={deleting} onClick={() => { setDeleteError(null); startDeleting(async () => { const result = await deleteSalesContextNote(note.id, note.revision); if (!result.ok) setDeleteError(result.error ?? "Could not remove note."); }); }} className="font-bold text-danger disabled:opacity-50">Remove</button>}
              </div>
            </div>
          </article>)}
          {!displayedNotes.length && <p className="rounded-xl border border-dashed border-line p-5 text-center text-sm text-taupe">No events or context notes in this period.</p>}
          {deleteError && <p className="text-xs font-semibold text-danger">{deleteError}</p>}
        </div>
      </div>
      <form ref={formRef} action={action} className="rounded-xl border border-line bg-cream/30 p-4">
        <h3 className="font-display font-bold text-cocoa">Add event or context</h3>
        <div className="mt-3 grid gap-3">
          <label className="text-xs font-bold text-taupe">Date<input required type="date" name="sales_date" min="2020-01-01" max={latestEventDate.toISOString().slice(0, 10)} defaultValue={today} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa" /></label>
          <label className="text-xs font-bold text-taupe">Machine / sales point<select name="machine_id" defaultValue={selectedMachineId ?? ""} className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa"><option value="">All accessible sales points</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}{machine.location ? ` · ${machine.location}` : " · Location not set"}</option>)}</select></label>
          <label className="text-xs font-bold text-taupe">Category<select name="category" defaultValue="event" className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa">{Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="text-xs font-bold text-taupe">What happened?<textarea required name="body" maxLength={2000} rows={4} placeholder="Festival nearby, promotion launched, machine unavailable..." className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa" /></label>
          <label className="text-xs font-bold text-taupe">Source URL · optional<input type="url" name="source_url" maxLength={1000} placeholder="https://..." className="mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa" /></label>
          {state.error && <p className="text-xs font-semibold text-danger">{state.error}</p>}{state.message && <p className="text-xs font-semibold text-sage">{state.message}</p>}
          <button disabled={pending} className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{pending ? "Adding..." : "Add event/context"}</button>
        </div>
      </form>
    </div>
  </section>;
}
