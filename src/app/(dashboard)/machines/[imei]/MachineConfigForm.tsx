"use client";

import { useState } from "react";
import { useActionState } from "react";
import { saveMachineConfig, type SaveResult } from "./actions";
import type { MachineConfig } from "@/lib/data/machine-config";
import { ClearDefrostInterventionButton } from "./ClearDefrostInterventionButton";

export function MachineConfigForm({ config, imei, today, lastCleanDate }: { config: MachineConfig; imei: string; today: string; lastCleanDate: string }) {
  const [profile, setProfile] = useState(config.profile ?? "");
  const [res, action, pending] = useActionState<SaveResult | null, FormData>(saveMachineConfig, null);

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
          <span className={labelClass}>Service warehouse</span>
          <select name="odoo_warehouse_id" defaultValue={config.odooWarehouseId ?? ""} className={selectClass}>
            <option value="">Not assigned</option>
            {config.odooWarehouses.map((warehouse) => <option key={warehouse.odoo_id} value={warehouse.odoo_id}>{warehouse.name}{warehouse.code ? ` (${warehouse.code})` : ""}</option>)}
          </select>
          <span className="mt-1 block text-[10px] text-taupe">Required before QR refills can be recorded.</span>
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
          <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-taupe">Daily automated defrost</legend>
          <div className="mt-2 flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 pb-2 text-sm font-bold text-cocoa"><input type="checkbox" name="defrost_enabled" defaultChecked={config.defrostSchedule?.enabled ?? false} className="accent-terracotta" />Enabled</label>
            <label><span className={labelClass}>Start time</span><input type="time" name="defrost_time" defaultValue={config.defrostSchedule?.localStartTime ?? "03:00"} className={selectClass} /></label>
            <label><span className={labelClass}>Defrost minutes</span><input type="number" name="defrost_minutes" min="1" max="30" step="1" defaultValue={config.defrostSchedule?.defrostMinutes ?? 4} className={`w-24 ${selectClass}`} /></label>
            <p className="max-w-xl pb-2 text-xs text-taupe">Europe/Madrid time. Sales and refrigeration are disabled before defrost. Afterward, refrigeration must report Abrir/Open, formation must freshly reach 100%, and sales must report Abrir/Open. Failures require intervention.</p>
          </div>
          {config.latestDefrostRun && <p className={`mt-3 text-xs font-semibold ${config.latestDefrostRun.state === "failed" || config.latestDefrostRun.state === "manual_intervention" ? "text-danger" : "text-taupe"}`}>Latest run: {config.latestDefrostRun.state.replaceAll("_", " ")}{config.latestDefrostRun.lastFormationPct != null ? ` · Formation ${config.latestDefrostRun.lastFormationPct}%` : ""}{config.latestDefrostRun.failureDetail ? ` · ${config.latestDefrostRun.failureDetail}` : ""}</p>}
          {config.defrostSchedule?.requiresIntervention && config.machineId && <ClearDefrostInterventionButton machineId={config.machineId} imei={imei} />}
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
            {res.ok ? "Saved." : res.error}
          </span>
        )}
      </div>
    </form>
  );
}
