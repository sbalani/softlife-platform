import type { SupabaseClient } from "@supabase/supabase-js";
import { COUPON_PATHS, type ProductDiyItem, type DiyPushItem } from "@/lib/huaxin/client";
import type { SessionProfile } from "@/lib/auth/session";

type Menu = { diy: ProductDiyItem[]; unify: ProductDiyItem[] };
type Snapshot = Record<string, Record<string, unknown>>;
type Actor = Pick<SessionProfile, "id" | "email"> | null;

export type ChangeLogFilters = {
  dateFrom?: string;
  dateTo?: string;
  machine?: string;
  source?: string;
  field?: string;
};

export type ChangeLogRow = {
  id: string;
  created_at: string;
  device_imei: string | null;
  machine_name: string | null;
  source: string;
  action: string;
  entity_type: string;
  entity_key: string | null;
  field: string | null;
  old_value: unknown;
  new_value: unknown;
  actor_email: string | null;
  metadata: Record<string, unknown>;
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, normalize(val)]));
}

export function menuSnapshot(menu: Menu): Snapshot {
  const snapshot: Snapshot = {};
  for (const kind of ["diy", "unify"] as const) {
    menu[kind].forEach((item, index) => {
      const key = `${kind}:${item.position ?? index}`;
      const fields: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(item)) {
        if (field !== "position" && field !== "languagePacks") fields[field] = normalize(value);
      }
      if (Array.isArray(item.languagePacks)) {
        for (const pack of item.languagePacks) {
          if (!pack.code) continue;
          if (pack.goodsName != null) fields[`goodsName.${pack.code}`] = pack.goodsName;
          if (pack.intro != null) fields[`intro.${pack.code}`] = pack.intro;
        }
      }
      snapshot[key] = fields;
    });
  }
  return snapshot;
}

export function diffSnapshots(before: Snapshot, after: Snapshot) {
  const changes: { entityKey: string; field: string; oldValue: unknown; newValue: unknown }[] = [];
  for (const entityKey of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const oldFields = before[entityKey] ?? {};
    const newFields = after[entityKey] ?? {};
    for (const field of new Set([...Object.keys(oldFields), ...Object.keys(newFields)])) {
      const oldValue = oldFields[field] ?? null;
      const newValue = newFields[field] ?? null;
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changes.push({ entityKey, field, oldValue, newValue });
    }
  }
  return changes;
}

function baseRow(machine: { id: string; device_imei: string; name?: string | null }, actor: Actor) {
  return {
    machine_id: machine.id,
    device_imei: machine.device_imei,
    machine_name: machine.name ?? null,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    metadata: {},
  };
}

export async function recordMachineSync(
  s: SupabaseClient,
  machine: { id: string; device_imei: string; name?: string | null },
  menu: Menu,
  actor: Actor,
) {
  const next = menuSnapshot(menu);
  const { data: saved, error: readError } = await s.from("machine_menu_snapshots").select("snapshot").eq("device_imei", machine.device_imei).maybeSingle();
  if (readError) throw new Error(`Could not read machine audit snapshot: ${readError.message}`);
  const previous = (saved?.snapshot as Snapshot | undefined) ?? null;
  const changes = previous ? diffSnapshots(previous, next) : [];
  const rows = [
    {
      ...baseRow(machine, actor),
      source: "machine_sync",
      action: previous ? "sync" : "baseline",
      entity_type: "machine",
      metadata: { changed_fields: changes.length },
    },
    ...changes.map((change) => ({
      ...baseRow(machine, actor),
      source: "machine_sync",
      action: "pulled_change",
      entity_type: "menu_item",
      entity_key: change.entityKey,
      field: change.field,
      old_value: change.oldValue,
      new_value: change.newValue,
    })),
  ];
  const { error: logError } = await s.from("machine_change_log").insert(rows);
  if (logError) throw new Error(`Could not write machine change log: ${logError.message}`);
  const { error: snapshotError } = await s.from("machine_menu_snapshots").upsert({ device_imei: machine.device_imei, machine_id: machine.id, snapshot: next, synced_at: new Date().toISOString() });
  if (snapshotError) throw new Error(`Could not save machine audit snapshot: ${snapshotError.message}`);
}

export async function recordMachinePush(
  s: SupabaseClient,
  machine: { id: string; device_imei: string; name?: string | null },
  items: DiyPushItem[],
  actor: Actor,
) {
  const { data: saved, error: readError } = await s.from("machine_menu_snapshots").select("snapshot").eq("device_imei", machine.device_imei).maybeSingle();
  if (readError) throw new Error(`Could not read machine audit snapshot: ${readError.message}`);
  const snapshot = ((saved?.snapshot as Snapshot | undefined) ?? {});
  const rows: Record<string, unknown>[] = [{
    ...baseRow(machine, actor), source: "platform", action: "push", entity_type: "machine", metadata: { fields_sent: items.length },
  }];
  for (const item of items) {
    const entityKey = Object.keys(snapshot).find((key) => key.endsWith(`:${item.position}`)) ?? `diy:${item.position}`;
    const field = item.code === "language" && typeof item.value === "object" ? `${item.value.code}.${item.value.language}` : item.code;
    const newValue = item.code === "language" && typeof item.value === "object" ? item.value.value : item.value;
    const oldValue = snapshot[entityKey]?.[field] ?? null;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    rows.push({ ...baseRow(machine, actor), source: "platform", action: "pushed_change", entity_type: "menu_item", entity_key: entityKey, field, old_value: oldValue, new_value: newValue });
    snapshot[entityKey] = { ...(snapshot[entityKey] ?? {}), [field]: newValue };
  }
  const { error: logError } = await s.from("machine_change_log").insert(rows);
  if (logError) throw new Error(`Could not write machine change log: ${logError.message}`);
  if (saved) {
    const { error: snapshotError } = await s.from("machine_menu_snapshots").upsert({ device_imei: machine.device_imei, machine_id: machine.id, snapshot, synced_at: new Date().toISOString() });
    if (snapshotError) throw new Error(`Could not save machine audit snapshot: ${snapshotError.message}`);
  }
}

export async function recordProductChange(
  s: SupabaseClient,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  actor: Actor,
  source: "platform" | "odoo" = "platform",
) {
  const ignored = new Set(["created_at", "updated_at"]);
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after)]);
  const changes = [...fields].filter((field) => !ignored.has(field) && JSON.stringify(normalize(before?.[field] ?? null)) !== JSON.stringify(normalize(after[field] ?? null)));
  if (!changes.length) return;
  const rows = changes.map((field) => ({
    source,
    action: before ? "updated" : "created",
    entity_type: "product",
    entity_key: String(after.id ?? before?.id ?? ""),
    field,
    old_value: before?.[field] ?? null,
    new_value: after[field] ?? null,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    metadata: { product_name: after.name ?? before?.name ?? null },
  }));
  const { error } = await s.from("machine_change_log").insert(rows);
  if (error) throw new Error(`Could not write product change log: ${error.message}`);
}

export async function recordCouponExchange(
  s: SupabaseClient,
  operation: string,
  request: Record<string, unknown>,
  response: unknown,
  actor: Actor,
) {
  const { error } = await s.from("machine_change_log").insert({
    device_imei: typeof request.deviceImeis === "string" ? request.deviceImeis : null,
    source: "platform",
    action: `coupon_${operation}`,
    entity_type: "coupon",
    entity_key: String(request.couponId ?? "0"),
    field: "api_exchange",
    old_value: request,
    new_value: response,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    metadata: { endpoint: COUPON_PATHS[operation as keyof typeof COUPON_PATHS] ?? operation },
  });
  if (error) throw new Error(`Could not write coupon API log: ${error.message}`);
}

export async function getChangeLog(s: SupabaseClient, filters: ChangeLogFilters): Promise<ChangeLogRow[]> {
  let query = s.from("machine_change_log").select("*").order("created_at", { ascending: false }).limit(500);
  if (filters.dateFrom) query = query.gte("created_at", `${filters.dateFrom}T00:00:00`);
  if (filters.dateTo) query = query.lte("created_at", `${filters.dateTo}T23:59:59.999`);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.field) query = query.ilike("field", `%${filters.field}%`);
  if (filters.machine) query = query.or(`machine_name.ilike.%${filters.machine}%,device_imei.ilike.%${filters.machine}%`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data as ChangeLogRow[]) ?? [];
}
