import type { SupabaseClient } from "@supabase/supabase-js";
import { COUPON_PATHS, type ProductDiyItem, type DiyPushItem } from "../huaxin/client.ts";
import type { SessionProfile } from "@/lib/auth/session";

type Menu = { diy: ProductDiyItem[]; unify: ProductDiyItem[] };
type Snapshot = Record<string, Record<string, unknown>>;
type Actor = Pick<SessionProfile, "id" | "email"> | null;
type Machine = { id: string; device_imei: string; name?: string | null };

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

export function menuFromSnapshot(snapshot: Snapshot): Menu {
  const menu: Menu = { diy: [], unify: [] };
  for (const [entityKey, fields] of Object.entries(snapshot)) {
    const [kind, position] = entityKey.split(":");
    if (kind !== "diy" && kind !== "unify") continue;
    const item: Record<string, unknown> = { position: /^\d+$/.test(position) ? Number(position) : position };
    const packs = new Map<string, { code: string; goodsName?: string; intro?: string }>();
    for (const [field, value] of Object.entries(fields)) {
      const [name, language] = field.split(".");
      if (language && (name === "goodsName" || name === "intro")) {
        const pack = packs.get(language) ?? { code: language };
        pack[name] = String(value ?? "");
        packs.set(language, pack);
      } else {
        item[field] = value;
      }
    }
    item.languagePacks = [...packs.values()];
    menu[kind].push(item as ProductDiyItem);
  }
  for (const kind of ["diy", "unify"] as const) {
    menu[kind].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
  }
  return menu;
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

function baseRow(machine: Machine, actor: Actor) {
  return {
    machine_id: machine.id,
    device_imei: machine.device_imei,
    machine_name: machine.name ?? null,
    actor_id: actor?.id ?? null,
    actor_email: actor?.email ?? null,
    metadata: {},
  };
}

const LANE_TO_POSITION: Record<string, string> = {
  "2": "solid_1", "3": "solid_2", "4": "solid_3",
  "5": "liquid_1", "6": "liquid_2", "7": "liquid_3",
};

async function machineProductIds(s: SupabaseClient, machineId: string) {
  const [{ data: machine }, { data: ingredients }] = await Promise.all([
    s.from("machines").select("base_product_id").eq("id", machineId).maybeSingle(),
    s.from("machine_ingredients").select("position,product_id").eq("machine_id", machineId),
  ]);
  const ids = new Map<string, string>();
  const baseProductId = (machine as { base_product_id?: string | null } | null)?.base_product_id;
  if (baseProductId) ids.set("1", baseProductId);
  const byPosition = new Map(((ingredients as { position: string; product_id: string | null }[]) ?? []).map((row) => [row.position, row.product_id]));
  for (const [lane, position] of Object.entries(LANE_TO_POSITION)) {
    const productId = byPosition.get(position);
    if (productId) ids.set(lane, productId);
  }
  return ids;
}

export function menuProductIdMap(menu: Menu, products: { id: string; name: string }[]) {
  const byName = new Map(products.map((product) => [product.name.toLowerCase().trim(), product.id]));
  return new Map(menu.diy.flatMap((item) => {
    const productId = item.goodsName ? byName.get(item.goodsName.toLowerCase().trim()) : null;
    return productId && item.position != null ? [[String(item.position), productId] as const] : [];
  }));
}

async function menuProductIds(s: SupabaseClient, menu: Menu) {
  const { data } = await s.from("products").select("id,name");
  return menuProductIdMap(menu, (data as { id: string; name: string }[]) ?? []);
}

function productIdForEntity(entityKey: string, productIds: Map<string, string>) {
  const [kind, position] = entityKey.split(":");
  return kind === "diy" ? productIds.get(position) ?? null : null;
}

export async function recordMachineSync(
  s: SupabaseClient,
  machine: Machine,
  menu: Menu,
  actor: Actor,
) {
  const next = menuSnapshot(menu);
  const productIds = await menuProductIds(s, menu);
  const { data: saved, error: readError } = await s.from("machine_menu_snapshots").select("snapshot").eq("device_imei", machine.device_imei).maybeSingle();
  if (readError) throw new Error(`Could not read machine audit snapshot: ${readError.message}`);
  const previous = (saved?.snapshot as Snapshot | undefined) ?? null;
  const changes = previous ? diffSnapshots(previous, next) : [];
  const changedFields = new Set(changes.map((change) => `${change.entityKey}:${change.field}`));
  const observations = Object.entries(next).flatMap(([entityKey, fields]) =>
    ["price", "marketPrice", "stock"].flatMap((field) =>
      fields[field] == null || changedFields.has(`${entityKey}:${field}`) ? [] : [{ entityKey, field, value: fields[field] }]
    )
  );
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
      product_id: productIdForEntity(change.entityKey, productIds),
      field: change.field,
      old_value: change.oldValue,
      new_value: change.newValue,
    })),
    ...observations.map((observation) => ({
      ...baseRow(machine, actor),
      source: "machine_sync",
      action: "observed",
      entity_type: "menu_item",
      entity_key: observation.entityKey,
      product_id: productIdForEntity(observation.entityKey, productIds),
      field: observation.field,
      old_value: previous?.[observation.entityKey]?.[observation.field] ?? null,
      new_value: observation.value,
    })),
  ];
  const { error: logError } = await s.from("machine_change_log").insert(rows);
  if (logError) throw new Error(`Could not write machine change log: ${logError.message}`);
  const { error: snapshotError } = await s.from("machine_menu_snapshots").upsert({ device_imei: machine.device_imei, machine_id: machine.id, snapshot: next, synced_at: new Date().toISOString() });
  if (snapshotError) throw new Error(`Could not save machine audit snapshot: ${snapshotError.message}`);
}

export async function recordMachinePush(
  s: SupabaseClient,
  machine: Machine,
  items: DiyPushItem[],
  actor: Actor,
) {
  const productIds = await machineProductIds(s, machine.id);
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
    rows.push({ ...baseRow(machine, actor), source: "platform", action: "pushed_change", entity_type: "menu_item", entity_key: entityKey, product_id: productIdForEntity(entityKey, productIds), field, old_value: oldValue, new_value: newValue });
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
    product_id: String(after.id ?? before?.id ?? "") || null,
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

export type HuaxinStatusRow = { code?: string; value?: string; desc?: string; data?: string | number };

export function alertStatusSignals(rows: HuaxinStatusRow[]) {
  const byCode = new Map(rows.map((row) => [row.code, row]));
  const active = (code: string) => {
    const row = byCode.get(code);
    if (!row) return null;
    if (row.data != null) return String(row.data) !== "0";
    return !["normal", "0", "false"].includes(String(row.value ?? "").toLowerCase());
  };
  const signals: { field: string; value: boolean; raw: HuaxinStatusRow }[] = [];
  const cup = byCode.get("status_0_cuplack");
  if (cup) signals.push({ field: "cup_empty", value: active("status_0_cuplack")!, raw: cup });
  const material = byCode.get("status_0_lackmaterial");
  if (material) signals.push({ field: "material_empty", value: active("status_0_lackmaterial")!, raw: material });
  const online = byCode.get("status_0_online_status");
  if (online) signals.push({ field: "device_online", value: String(online.value).toLowerCase() === "online", raw: online });
  return signals;
}

export async function recordMachineStatuses(s: SupabaseClient, machine: Machine, rows: HuaxinStatusRow[]) {
  const signals = alertStatusSignals(rows);
  const { data: saved, error: readError } = await s.from("machine_status_snapshots").select("field,value").eq("machine_id", machine.id);
  if (readError) throw new Error(`Could not read machine status snapshots: ${readError.message}`);
  const savedRows = (saved as { field: string; value: unknown }[]) ?? [];
  const previous = new Map(savedRows.map((row) => [row.field, row.value]));
  if (signals.length) {
    const { error } = await s.from("machine_change_log").insert(signals.map((signal) => ({
      ...baseRow(machine, null),
      source: "machine_sync",
      action: previous.has(signal.field) && previous.get(signal.field) !== signal.value ? "status_changed" : "observed",
      entity_type: "machine_status",
      entity_key: signal.raw.code,
      field: signal.field,
      old_value: previous.get(signal.field) ?? null,
      new_value: signal.value,
      metadata: { description: signal.raw.desc, raw_value: signal.raw.value, raw_data: signal.raw.data },
    })));
    if (error) throw new Error(`Could not write machine status observations: ${error.message}`);
  }
  const observedAt = new Date().toISOString();
  const rawSnapshots = [...new Map(rows.map((row, index) => {
    const field = `raw:${row.code ?? index}`;
    return [field, { machine_id: machine.id, field, value: row.value ?? row.data ?? "", raw: row, observed_at: observedAt }];
  })).values()];
  const snapshots = [
    ...signals.map((signal) => ({ machine_id: machine.id, field: signal.field, value: signal.value, raw: signal.raw, observed_at: observedAt })),
    ...rawSnapshots,
  ];
  if (snapshots.length) {
    const { error: snapshotError } = await s.from("machine_status_snapshots").upsert(snapshots);
    if (snapshotError) throw new Error(`Could not save machine status snapshots: ${snapshotError.message}`);
  }
  const currentRawFields = new Set(rawSnapshots.map((row) => row.field));
  const staleRawFields = savedRows.filter((row) => row.field.startsWith("raw:") && !currentRawFields.has(row.field)).map((row) => row.field);
  if (staleRawFields.length) {
    const { error: deleteError } = await s.from("machine_status_snapshots").delete().eq("machine_id", machine.id).in("field", staleRawFields);
    if (deleteError) throw new Error(`Could not remove stale machine statuses: ${deleteError.message}`);
  }
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
