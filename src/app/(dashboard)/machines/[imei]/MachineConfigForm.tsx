"use client";

import { useState } from "react";
import { useActionState } from "react";
import { saveMachineConfig, type SaveResult } from "./actions";
import type { MachineConfig } from "@/lib/data/machine-config";
import { ClearDefrostInterventionButton } from "./ClearDefrostInterventionButton";
import { formatDateTime } from "@/lib/dates";

export function MachineConfigForm({ config, imei, today, lastCleanDate, timeZone }: { config: MachineConfig; imei: string; today: string; lastCleanDate: string; timeZone: string }) {
  const [profile, setProfile] = useState(config.profile ?? "");
  const [cashTrackingEnabled, setCashTrackingEnabled] = useState(config.cashTrackingEnabled);
  const [res, action, pending] = useActionState<SaveResult | null, FormData>(saveMachineConfig, null);
  const activeDefrostState = config.defrostRuns.find((run) => ["scheduled", "thawing", "thaw_closed", "refrigeration_check", "forming", "sales_check", "recovery"].includes(run.state))?.state ?? null;

  const selectClass =
    "rounded-lg border border-line bg-white px-3 py-2 text-sm text-cocoa focus:border-terracotta focus:outline-none";
  const labelClass = "mb-1 block text-[11px] uppercase tracking-wide text-taupe";

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="machine_id" value={config.machineId ?? ""} />
      <input type="hidden" name="imei" value={imei} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Profile</span>
          <select
            name="profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            className={selectClass}
          >
            <option value="">—</option>
            <option value="3+3">3+3 (3 solid + 3 liquid)</option>
            <option value="manual">Manual (no dispensers)</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Current service warehouse</span>
          <select name="odoo_warehouse_id" defaultValue={config.odooWarehouseId ?? ""} className={selectClass}>
            <option value="">Not assigned</option>
            {config.odooWarehouses.map((warehouse) => <option key={warehouse.odoo_id} value={warehouse.odoo_id}>{warehouse.name}{warehouse.code ? ` (${warehouse.code})` : ""}</option>)}
          </select>
          <span className="mt-1 block text-[10px] text-taupe">Effective now. Use assignment periods below for historical or temporary locations.</span>
        </label>
        <label className="block">
          <span className={labelClass}>Display name</span>
          <input type="text" name="display_name" defaultValue={config.displayName ?? ""} placeholder="e.g. Málaga Centro" className={selectClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Record full clean date</span>
          <input type="date" name="last_full_clean" defaultValue={lastCleanDate} max={today} className={selectClass} />
          <span className="mt-1 block text-[10px] text-taupe">Blank does not erase cleaning history.</span>
        </label>
        <label className="block">
          <span className={labelClass}>Nayax terminal ID</span>
          <input type="text" name="nayax_id" defaultValue={config.nayaxId ?? ""} placeholder="e.g. 123456" className={selectClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Location (override)</span>
          <input
            name="location_override"
            defaultValue={config.locationOverride ?? ""}
            placeholder={config.location ?? "Detected automatically"}
            className={selectClass}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Payment model</span>
          <select name="payment_model" defaultValue={config.paymentModel ?? "automatic"} className={selectClass}>
            <option value="automatic">Automatic (end users pay machine)</option>
            <option value="server">Server (franchisee collects — we bill them)</option>
            <option value="hybrid">Hybrid (both)</option>
          </select>
        </label>
        <label className="flex items-start gap-3 rounded-xl border border-line bg-cream/40 p-3 sm:col-span-2">
          <input type="checkbox" name="deployed" defaultChecked={config.deployed} className="mt-1 accent-terracotta" />
          <span><span className="block text-sm font-bold text-cocoa">Deployed and monitored</span><span className="mt-1 block text-xs text-taupe">Undeployed machines keep their history but do not generate alerts, mobile notifications, or franchise/operator access.</span></span>
        </label>
        <fieldset className="rounded-xl border border-line bg-white p-3 sm:col-span-3">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-taupe">Cashbox</legend>
          <label className="mt-2 flex items-start gap-3"><input type="checkbox" name="cash_tracking_enabled" checked={cashTrackingEnabled} onChange={(event) => setCashTrackingEnabled(event.target.checked)} className="mt-1 accent-terracotta" /><span><span className="block text-sm font-bold text-cocoa">Track physical cash</span><span className="text-xs text-taupe">Only users with cashbox permission and existing machine access can view or reconcile it.</span></span></label>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label><span className={labelClass}>{config.cashTrackingEnabled ? "New balance anchor · optional" : "Opening balance"}</span><input name="cash_balance" inputMode="decimal" placeholder={config.cashTrackingEnabled ? "Leave blank to keep current anchor" : "0.00"} className={`w-full ${selectClass}`} required={cashTrackingEnabled && !config.cashTrackingEnabled} /></label>
            <label><span className={labelClass}>Effective time · optional</span><input name="cash_effective_at" type="datetime-local" className={`w-full ${selectClass}`} /><span className="mt-1 block text-[10px] text-taupe">Defaults to now in Europe/Madrid.</span></label>
            {config.cashAnchorBalanceCents !== null && <div className="rounded-lg bg-cream px-3 py-2 text-xs text-taupe"><span className="block font-bold text-cocoa">Current expected cash</span>EUR {((config.cashExpectedCents ?? config.cashAnchorBalanceCents) / 100).toFixed(2)}<span className="mt-1 block">Last physical anchor: EUR {(config.cashAnchorBalanceCents / 100).toFixed(2)}</span></div>}
          </div>
          {config.cashTrackingEnabled && !cashTrackingEnabled && <div className="mt-3 grid gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 sm:grid-cols-2"><label><span className={labelClass}>Final physical count</span><input name="cash_final_count" inputMode="decimal" placeholder="0.00" required className={`w-full ${selectClass}`} /></label><label><span className={labelClass}>Final amount withdrawn</span><input name="cash_final_withdrawal" inputMode="decimal" placeholder="0.00" required className={`w-full ${selectClass}`} /></label><p className="text-xs text-warning sm:col-span-2">Disabling requires a full count and withdrawal. The two amounts must match.</p></div>}
          {config.cashLedger.length > 0 && <details className="mt-3 rounded-lg bg-cream/60 px-3 py-2"><summary className="cursor-pointer text-xs font-bold text-cocoa">Recent cash ledger ({config.cashLedger.length})</summary><div className="mt-2 divide-y divide-line">{config.cashLedger.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="text-cocoa">{entry.entryType.replaceAll("_", " ")} · {formatDateTime(entry.occurredAt, timeZone)}</span><span className={entry.amountCents < 0 ? "font-bold text-danger" : "font-bold text-sage"}>{entry.amountCents < 0 ? "−" : "+"}EUR {(Math.abs(entry.amountCents) / 100).toFixed(2)}</span></div>)}</div></details>}
        </fieldset>
        <fieldset className="rounded-xl border border-line bg-white p-3 sm:col-span-3">
          <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-taupe">Daily automated defrost</legend>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 pb-2 text-sm font-bold text-cocoa"><input type="checkbox" name="defrost_enabled" defaultChecked={config.defrostSchedule?.enabled ?? false} className="accent-terracotta" />Enabled</label>
            <label><span className={labelClass}>Start time</span><input type="time" name="defrost_time" defaultValue={config.defrostSchedule?.localStartTime ?? "03:00"} className={selectClass} /></label>
            <label><span className={labelClass}>Defrost minutes</span><input type="number" name="defrost_minutes" min="1" max="30" step="1" defaultValue={config.defrostSchedule?.defrostMinutes ?? 4} className={`w-24 ${selectClass}`} /></label>
            <p className="max-w-xl pb-2 text-xs text-taupe">Europe/Madrid time. Sales and refrigeration are disabled before defrost. Afterward, refrigeration must report Abrir/Open, formation must freshly reach 100%, and sales must report Abrir/Open. Failures require intervention.</p>
          </div>
          {config.defrostSchedule?.requiresIntervention && config.machineId && <ClearDefrostInterventionButton machineId={config.machineId} imei={imei} activeState={activeDefrostState} />}
        </fieldset>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-terracotta px-4 py-2 text-sm font-bold text-white hover:bg-terracotta-dark disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save configuration"}
        </button>
        {res && (
          <span className={`text-sm font-semibold ${res.ok ? "text-sage" : "text-danger"}`}>
            {res.ok ? res.warning ?? "Saved." : res.error}
          </span>
        )}
      </div>
    </form>
  );
}
