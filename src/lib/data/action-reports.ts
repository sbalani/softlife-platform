import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { modesFromLegacyKind, parseActionReportModes, type ActionReportMode, type LegacyActionReportKind } from "@/lib/action-report-modes";
import { reconstructStockAtAction, type StockReconstructionOrder } from "@/lib/action-report-stock-reconstruction";
import { coversOrderRange } from "@/lib/data/order-sync-status";
import { DEFAULT_TZ, ymd } from "@/lib/dates";

export type ActionReportHistoryItem = {
  id: string;
  actionKind: string;
  actionModes: ActionReportMode[];
  occurredAt: string;
  status: string;
  provenanceStatus: string;
  machineName: string;
  notes: string | null;
  refillLines: { quantity: number; unit: string; lotCode: string | null; productName: string | null; provenanceStatus: string }[];
  stockSnapshot: { capturedAt: string; status: string; items: { menuKind: string; position: string; goodsName: string | null; observedStock: number | null; consumedSinceAction: number; stockAtAction: number | null; calculationComplete: boolean; incompleteReason: string | null }[] } | null;
  canRetryStockSnapshot: boolean;
  incidents: { id: string; title: string }[];
};

export type ActionReportLotOption = {
  odooId: number;
  name: string;
  productName: string;
  available: number;
  warehouseId: number;
};

export type ActionReportDraft = {
  id: string;
  clientUuid: string;
  machineId: string;
  occurredAt: string;
  actionKind: LegacyActionReportKind;
  actionModes: ActionReportMode[];
  notes: string;
  cleaningMaterialUsed: boolean | null;
  waterBucketCount: number | null;
  lines: { odooLotId: number | null; lotCode: string; productName: string; quantity: number; unit: string }[];
  incidentIds: string[];
};

export async function getActionReportLots(warehouseIds: number[]): Promise<ActionReportLotOption[]> {
  if (!isSupabaseConfigured() || warehouseIds.length === 0) return [];
  const s = await createServiceClient();
  const { data: stock, error: stockError } = await s.from("warehouse_lot_effective_balances")
    .select("odoo_lot_id,odoo_warehouse_id,effective_quantity").in("odoo_warehouse_id", warehouseIds).gt("effective_quantity", 0);
  if (stockError) throw stockError;
  const rows = (stock as { odoo_lot_id: number; odoo_warehouse_id: number; effective_quantity: number }[]) ?? [];
  if (!rows.length) return [];
  const { data: lots, error: lotError } = await s.from("odoo_lots")
    .select("odoo_id,name,product_name,expiration_date").in("odoo_id", [...new Set(rows.map((row) => row.odoo_lot_id))]);
  if (lotError) throw lotError;
  const lotById = new Map(((lots as { odoo_id: number; name: string; product_name: string | null; expiration_date: string | null }[]) ?? []).map((lot) => [lot.odoo_id, lot]));
  return rows.flatMap((row) => {
    const lot = lotById.get(row.odoo_lot_id);
    const available = Math.max(0, Number(row.effective_quantity));
    return lot && available > 0 ? [{ odooId: lot.odoo_id, name: lot.name, productName: lot.product_name ?? "Unknown product", available, warehouseId: row.odoo_warehouse_id, expiration: lot.expiration_date }] : [];
  }).sort((a, b) => (a.expiration ?? "9999").localeCompare(b.expiration ?? "9999") || a.name.localeCompare(b.name))
    .map((lot) => ({ odooId: lot.odooId, name: lot.name, productName: lot.productName, available: lot.available, warehouseId: lot.warehouseId }));
}

export async function getActionReportHistory(filters: { machineIds?: string[]; tenantId?: string; actorId?: string; operatorId?: string; canViewIncidents?: boolean; incidentTenantId?: string }): Promise<ActionReportHistoryItem[]> {
  if (!isSupabaseConfigured() || (!filters.tenantId && filters.machineIds?.length === 0)) return [];
  const s = await createServiceClient();
  let query = s.from("service_action_reports")
    .select("id,machine_id,operator_id,action_kind,action_modes,occurred_at,status,provenance_status,notes,machines(name,display_name),service_action_refill_lines(quantity,unit,observed_lot_code,product_name,provenance_status),service_action_stock_snapshots(device_imei,captured_at,status,service_action_stock_snapshot_items(menu_kind,position,goods_name_raw,stock_count)),service_action_report_incidents(incidents(id,title,assigned_tenant_id))")
    .order("occurred_at", { ascending: false }).limit(50);
  if (filters.operatorId) query = query.eq("operator_id", filters.operatorId);
  if (filters.tenantId) query = query.eq("tenant_id", filters.tenantId);
  else if (filters.machineIds) query = query.in("machine_id", filters.machineIds);
  const { data, error } = await query;
  if (error) throw error;
  const reportRows = (data as Record<string, unknown>[]) ?? [];
  const snapshotWindows = reportRows.flatMap((row) => {
    const relation = row.service_action_stock_snapshots as Record<string, unknown> | Record<string, unknown>[] | null;
    const snapshot = Array.isArray(relation) ? relation[0] : relation;
    return snapshot ? [{ machineId: row.machine_id as string, occurredAt: row.occurred_at as string, capturedAt: snapshot.captured_at as string }] : [];
  });
  const orderRows: Record<string, unknown>[] = [];
  type CoverageRow = { device_imei: string; fresh_through: string; finished_at: string; order_sync_runs: { requested_from: string } | null };
  let coverageRows: CoverageRow[] = [];
  if (snapshotWindows.length) {
    const machineIds = [...new Set(snapshotWindows.map((window) => window.machineId))];
    const earliest = snapshotWindows.reduce((value, window) => window.occurredAt < value ? window.occurredAt : value, snapshotWindows[0].occurredAt);
    const latest = snapshotWindows.reduce((value, window) => window.capturedAt > value ? window.capturedAt : value, snapshotWindows[0].capturedAt);
    for (let offset = 0; ; offset += 1000) {
      const { data: orders, error: orderError } = await s.from("huaxin_orders")
        .select("id,machine_id,order_time,order_state,refund_status,pay_type_raw,nums,products,list_raw")
        .in("machine_id", machineIds).gt("order_time", earliest).lte("order_time", latest)
        .order("order_time").order("id").range(offset, offset + 999);
      if (orderError) throw orderError;
      orderRows.push(...((orders as Record<string, unknown>[]) ?? []));
      if (!orders || orders.length < 1000) break;
    }
    const deviceImeis = reportRows.flatMap((row) => {
      const relation = row.service_action_stock_snapshots as Record<string, unknown> | Record<string, unknown>[] | null;
      const snapshot = Array.isArray(relation) ? relation[0] : relation;
      return snapshot?.device_imei ? [snapshot.device_imei as string] : [];
    });
    const earliestDay = snapshotWindows.reduce((value, window) => {
      const day = ymd(new Date(window.occurredAt), DEFAULT_TZ);
      return day < value ? day : value;
    }, ymd(new Date(snapshotWindows[0].occurredAt), DEFAULT_TZ));
    const { data: coverage, error: coverageError } = await s.from("order_sync_machine_results")
      .select("device_imei,fresh_through,finished_at,order_sync_runs(requested_from)")
      .in("device_imei", [...new Set(deviceImeis)]).eq("status", "succeeded").gte("fresh_through", earliestDay).limit(10000);
    if (coverageError) throw coverageError;
    coverageRows = (coverage as unknown as CoverageRow[]) ?? [];
  }
  const canonical = reportRows.filter((row) => row.status !== "draft" || !filters.actorId || row.operator_id === filters.actorId).map((row) => {
    const machine = row.machines as { name: string; display_name: string | null } | null;
    const lines = (row.service_action_refill_lines as Record<string, unknown>[]) ?? [];
    const snapshotRelation = row.service_action_stock_snapshots as Record<string, unknown> | Record<string, unknown>[] | null;
    const snapshot = Array.isArray(snapshotRelation) ? snapshotRelation[0] : snapshotRelation;
    const snapshotItems = (snapshot?.service_action_stock_snapshot_items as Record<string, unknown>[]) ?? [];
    const reconstructionOrders: StockReconstructionOrder[] = orderRows.filter((order) => order.machine_id === row.machine_id).map((order) => ({
      orderTime: order.order_time as string,
      orderState: String(order.order_state ?? ""),
      refundStatus: order.refund_status === null ? null : String(order.refund_status),
      payTypeRaw: order.pay_type_raw === null ? null : String(order.pay_type_raw),
      nums: Number(order.nums),
      products: Array.isArray(order.products) ? order.products as { position?: string | number }[] : [],
      listRaw: order.list_raw && typeof order.list_raw === "object" ? order.list_raw as StockReconstructionOrder["listRaw"] : null,
    }));
    const coverageIntervals = coverageRows.filter((coverage) => coverage.device_imei === snapshot?.device_imei).flatMap((coverage) => coverage.order_sync_runs ? [{ from: coverage.order_sync_runs.requested_from, through: coverage.fresh_through }] : []);
    const occurredDay = ymd(new Date(row.occurred_at as string), DEFAULT_TZ);
    const capturedDay = snapshot ? ymd(new Date(snapshot.captured_at as string), DEFAULT_TZ) : occurredDay;
    const syncedAfterObservation = snapshot ? coverageRows.some((coverage) => coverage.device_imei === snapshot.device_imei
      && coverage.finished_at >= String(snapshot.captured_at)
      && Boolean(coverage.order_sync_runs)
      && coverage.order_sync_runs!.requested_from <= capturedDay
      && coverage.fresh_through >= capturedDay) : false;
    const reconstructedItems = snapshot ? reconstructStockAtAction(snapshotItems.map((item) => ({
      menuKind: item.menu_kind as string,
      position: item.position as string,
      goodsName: item.goods_name_raw as string | null,
      observedStock: item.stock_count === null ? null : Number(item.stock_count),
    })), reconstructionOrders, row.occurred_at as string, snapshot.captured_at as string, syncedAfterObservation && coversOrderRange(coverageIntervals, occurredDay, capturedDay)) : [];
    return {
      id: row.id as string,
      actionKind: row.action_kind as string,
      actionModes: parseActionReportModes(row.action_modes, row.action_kind) ?? modesFromLegacyKind(row.action_kind),
      occurredAt: row.occurred_at as string,
      status: row.status as string,
      provenanceStatus: row.provenance_status as string,
      machineName: machine?.display_name || machine?.name || "Unknown machine",
      notes: row.notes as string | null,
      refillLines: lines.map((line) => ({
        quantity: Number(line.quantity),
        unit: line.unit as string,
        lotCode: line.observed_lot_code as string | null,
        productName: line.product_name as string | null,
        provenanceStatus: line.provenance_status as string,
      })),
      stockSnapshot: snapshot ? {
        capturedAt: snapshot.captured_at as string,
        status: snapshot.status as string,
        items: reconstructedItems.sort((a, b) => a.menuKind.localeCompare(b.menuKind) || Number(a.position) - Number(b.position)),
      } : null,
      canRetryStockSnapshot: !filters.actorId || row.operator_id === filters.actorId,
      incidents: filters.canViewIncidents ? ((row.service_action_report_incidents as { incidents: { id: string; title: string; assigned_tenant_id: string | null } | null }[]) ?? []).flatMap((link) => link.incidents && (!filters.incidentTenantId || link.incidents.assigned_tenant_id === filters.incidentTenantId) ? [{ id: link.incidents.id, title: link.incidents.title }] : []) : [],
    };
  });

  if (filters.machineIds?.length === 0) return canonical;
  let refillQuery = s.from("reposiciones")
    .select("id,device_event_time,status,payload_json,machines(name,display_name)")
    .is("service_action_report_id", null).order("device_event_time", { ascending: false }).limit(50);
  let cleaningQuery = s.from("clean_logs")
    .select("id,device_event_time,machines(name,display_name)")
    .is("service_action_report_id", null).order("device_event_time", { ascending: false }).limit(50);
  if (filters.operatorId) {
    refillQuery = refillQuery.eq("operator_id", filters.operatorId);
    cleaningQuery = cleaningQuery.eq("operator_id", filters.operatorId);
  }
  if (filters.tenantId) {
    refillQuery = refillQuery.eq("tenant_id", filters.tenantId);
    cleaningQuery = cleaningQuery.eq("tenant_id", filters.tenantId);
  } else if (filters.machineIds) {
    refillQuery = refillQuery.in("machine_id", filters.machineIds);
    cleaningQuery = cleaningQuery.in("machine_id", filters.machineIds);
  }
  const [{ data: refills, error: refillError }, { data: cleanings, error: cleaningError }] = await Promise.all([refillQuery, cleaningQuery]);
  if (refillError) throw refillError;
  if (cleaningError) throw cleaningError;
  const legacyRefills: ActionReportHistoryItem[] = ((refills as Record<string, unknown>[]) ?? []).map((row) => {
    const machine = row.machines as { name: string; display_name: string | null } | null;
    const payload = (row.payload_json as { lines?: Record<string, unknown>[] } | null) ?? {};
    return {
      id: row.id as string,
      actionKind: "refill",
      actionModes: ["refill"],
      occurredAt: row.device_event_time as string,
      status: row.status as string,
      provenanceStatus: "legacy",
      machineName: machine?.display_name || machine?.name || "Unknown machine",
      notes: null,
      refillLines: (payload.lines ?? []).map((line) => ({
        quantity: Number(line.quantity_used ?? line.qty ?? 0),
        unit: String(line.unit ?? "unit"),
        lotCode: String(line.lot_name ?? "") || null,
        productName: String(line.product_name ?? "") || null,
        provenanceStatus: "legacy",
      })),
      stockSnapshot: null,
      canRetryStockSnapshot: false,
      incidents: [],
    };
  });
  const legacyCleanings: ActionReportHistoryItem[] = ((cleanings as Record<string, unknown>[]) ?? []).map((row) => {
    const machine = row.machines as { name: string; display_name: string | null } | null;
    return {
      id: row.id as string,
      actionKind: "cleaning",
      actionModes: ["cleaning"],
      occurredAt: row.device_event_time as string,
      status: "confirmed",
      provenanceStatus: "legacy",
      machineName: machine?.display_name || machine?.name || "Unknown machine",
      notes: null,
      refillLines: [],
      stockSnapshot: null,
      canRetryStockSnapshot: false,
      incidents: [],
    };
  });
  return [...canonical, ...legacyRefills, ...legacyCleanings]
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 50);
}

export async function getActionReportDraft(id: string, tenantId?: string, actorId?: string): Promise<ActionReportDraft | null> {
  if (!isSupabaseConfigured() || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const s = await createServiceClient();
  let query = s.from("service_action_reports")
    .select("id,client_uuid,machine_id,occurred_at,action_kind,action_modes,notes,cleaning_material_used,water_bucket_count,service_action_refill_lines(odoo_lot_id:observed_odoo_lot_id,lot_code:observed_lot_code,product_name,quantity,unit,line_number),service_action_report_incidents(incident_id)")
    .eq("id", id).eq("status", "draft");
  if (tenantId) query = query.eq("tenant_id", tenantId);
  if (actorId) query = query.eq("operator_id", actorId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const lines = ((row.service_action_refill_lines as Record<string, unknown>[]) ?? [])
    .sort((a, b) => Number(a.line_number) - Number(b.line_number));
  return {
    id: row.id as string,
    clientUuid: row.client_uuid as string,
    machineId: row.machine_id as string,
    occurredAt: row.occurred_at as string,
    actionKind: row.action_kind as ActionReportDraft["actionKind"],
    actionModes: parseActionReportModes(row.action_modes, row.action_kind) ?? modesFromLegacyKind(row.action_kind),
    notes: (row.notes as string | null) ?? "",
    cleaningMaterialUsed: row.cleaning_material_used as boolean | null,
    waterBucketCount: row.water_bucket_count as number | null,
    lines: lines.map((line) => ({
      odooLotId: line.odoo_lot_id as number | null,
      lotCode: (line.lot_code as string | null) ?? "",
      productName: (line.product_name as string | null) ?? "",
      quantity: Number(line.quantity),
      unit: line.unit as string,
    })),
    incidentIds: ((row.service_action_report_incidents as { incident_id: string }[]) ?? []).map((link) => link.incident_id),
  };
}
