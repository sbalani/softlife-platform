"use client";

import { useActionState, useTransition } from "react";
import type { PasteurizationSchedule, PasteurizationSuggestion } from "@/lib/data/pasteurization";
import {
  acceptPasteurizationSuggestion, rejectPasteurizationSuggestion, savePasteurizationSchedule,
  setPasteurizationScheduleEnabled, type AlertRuleResult,
} from "./actions";

const input = "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
const label = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

function observed(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function PasteurizationManager({ machines, schedules, suggestions, timeZone, today }: {
  machines: { id: string; name: string }[];
  schedules: PasteurizationSchedule[];
  suggestions: PasteurizationSuggestion[];
  timeZone: string;
  today: string;
}) {
  const [result, action, pending] = useActionState<AlertRuleResult | null, FormData>(savePasteurizationSchedule, null);
  const [updating, startTransition] = useTransition();
  return <section className="mb-6 rounded-2xl border border-terracotta/25 bg-terracotta/5 p-5">
    <h2 className="font-display text-lg font-bold text-cocoa">Pasteurization alert windows</h2>
    <p className="mt-1 text-xs text-taupe">Temperature readings remain stored, but temperature alerts are suppressed during an active window. A schedule is operational alert handling only and is not proof that a product batch was pasteurized.</p>

    {suggestions.length > 0 && <div className="mt-4 space-y-3">
      <h3 className="text-sm font-bold text-cocoa">Detected patterns awaiting review</h3>
      {suggestions.map((suggestion) => <form key={suggestion.id} action={acceptPasteurizationSuggestion} className="rounded-xl border border-warning/30 bg-white p-3">
        <input type="hidden" name="suggestion_id" value={suggestion.id} />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="font-semibold text-cocoa">{suggestion.machineName} · {suggestion.seriesName}</p><p className="mt-1 text-xs text-taupe">Observed {observed(suggestion.observedStart, suggestion.timeZone)} to {observed(suggestion.observedEnd, suggestion.timeZone)} ({suggestion.timeZone}) · {suggestion.minimumCelsius.toFixed(1)}–{suggestion.maximumCelsius.toFixed(1)}°C · {suggestion.sampleCount} samples · largest gap {Math.round(suggestion.maximumGapMinutes)} min</p></div>
          <span className="rounded-full bg-warning/15 px-2.5 py-1 text-[10px] font-bold uppercase text-warning">Suggestion only</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label><span className={label}>Anchor date</span><input name="anchor_date" type="date" required defaultValue={suggestion.suggestedAnchorDate} className={input} /></label>
          <label><span className={label}>Every</span><select name="interval_days" defaultValue={suggestion.suggestedIntervalDays} className={input}><option value="1">1 day</option><option value="2">2 days</option><option value="3">3 days</option></select></label>
          <label><span className={label}>Local start</span><input name="start_local" type="time" required defaultValue={suggestion.suggestedStartLocal} className={input} /></label>
          <label><span className={label}>Window minutes</span><input name="duration_minutes" type="number" min="30" max="720" step="15" required defaultValue={suggestion.suggestedDurationMinutes} className={`w-28 ${input}`} /></label>
          <button className="rounded-lg bg-terracotta px-3 py-2 text-xs font-bold text-white">Accept schedule</button>
          <button type="button" disabled={updating} onClick={() => startTransition(() => rejectPasteurizationSuggestion(suggestion.id))} className="px-3 py-2 text-xs font-bold text-taupe">Reject</button>
        </div>
      </form>)}
    </div>}

    <form action={action} className="mt-5 flex flex-wrap items-end gap-3 border-t border-terracotta/15 pt-4">
      <label><span className={label}>Machine</span><select name="machine_id" required className={input}><option value="">Select machine</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}</select></label>
      <label><span className={label}>Temperature series</span><input name="series_name" placeholder="Blank = all series" className={`w-40 ${input}`} /></label>
      <label><span className={label}>Anchor date</span><input name="anchor_date" type="date" required defaultValue={today} className={input} /></label>
      <label><span className={label}>Every</span><select name="interval_days" defaultValue="2" className={input}><option value="1">1 day</option><option value="2">2 days</option><option value="3">3 days</option></select></label>
      <label><span className={label}>Local start</span><input name="start_local" type="time" required defaultValue="02:00" className={input} /></label>
      <label><span className={label}>Window minutes</span><input name="duration_minutes" type="number" min="30" max="720" step="15" required defaultValue="240" className={`w-28 ${input}`} /></label>
      <label><span className={label}>Timezone</span><input name="time_zone" required defaultValue={timeZone} className={`w-40 ${input}`} /></label>
      <button disabled={pending} className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white disabled:opacity-60">{pending ? "Saving..." : "Add window"}</button>
      {result && <span className={`text-xs ${result.ok ? "text-sage" : "text-danger"}`}>{result.ok ? "Window added." : result.error}</span>}
    </form>

    {schedules.length > 0 && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="text-left text-[11px] uppercase text-taupe"><tr><th className="py-2">Machine</th><th>Series</th><th>Recurrence</th><th>Local window</th><th>Timezone</th><th /></tr></thead><tbody className="divide-y divide-terracotta/10">{schedules.map((schedule) => <tr key={schedule.id} className={schedule.enabled ? "" : "opacity-50"}><td className="py-2 font-semibold text-cocoa">{schedule.machineName}</td><td>{schedule.seriesName ?? "All"}</td><td>Every {schedule.intervalDays} day{schedule.intervalDays === 1 ? "" : "s"} from {schedule.anchorDate}</td><td>{schedule.startLocal} for {schedule.durationMinutes} min</td><td>{schedule.timeZone}</td><td className="text-right"><button disabled={updating} onClick={() => startTransition(() => setPasteurizationScheduleEnabled(schedule.id, !schedule.enabled))} className="font-semibold text-terracotta">{schedule.enabled ? "Pause" : "Enable"}</button></td></tr>)}</tbody></table></div>}
  </section>;
}
