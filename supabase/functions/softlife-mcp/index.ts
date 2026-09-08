import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRIDGE_URL = Deno.env.get("HUAXIN_DEFROST_BRIDGE_URL") ?? "https://softlife-platform.vercel.app/api/internal/huaxin-defrost";
const STOCK_BRIDGE_URL = Deno.env.get("ACTION_REPORT_STOCK_BRIDGE_URL") ?? "https://platform.softlife.es/api/internal/action-report-stock";
const BRIDGE_TOKEN = Deno.env.get("HUAXIN_DEFROST_BRIDGE_TOKEN") ?? "";
const STOCK_BRIDGE_TOKEN = Deno.env.get("ACTION_REPORT_STOCK_BRIDGE_TOKEN") ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_DEFROST_STATES = ["scheduled", "thawing", "thaw_closed", "refrigeration_check", "forming", "sales_check", "recovery"];
const VALID_MODES = ["cleaning", "refill", "other"] as const;
const ADMIN_OVERRIDE_PAY_TYPES = new Set(["自动制作", "Admin override"]);
const PAYMENT_TYPES: Record<string, string> = {
  "微信支付": "WeChat Pay", "支付宝": "Alipay", "刷卡": "Card", "现金": "Cash",
  "投币": "Coin", "扫码支付": "QR Payment", "免费": "Free",
};
const MCP_PROTOCOL_VERSION = "2025-03-26";
const ACTION_REPORT_PHOTO_BUCKET = "service-action-evidence";
const MAX_ACTION_REPORT_PHOTO_BYTES = 4 * 1024 * 1024;
const ACTION_REPORT_PHOTO_TYPES: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
};
const SUPPORTED_PROTOCOL_VERSIONS = new Set([MCP_PROTOCOL_VERSION]);
const DEFAULT_ALLOWED_ORIGINS = ["https://platform.softlife.es", "https://softlife-platform.vercel.app", "https://chatgpt.com", "https://claude.ai"];

type Scope = "read" | "forms" | "commands" | "sales_context" | "sales_notes";
export type Principal = {
  keyId: string;
  profileId: string;
  role: "admin" | "operator" | "franchisee";
  tenantId: string | null;
  name: string;
  scopes: Set<Scope>;
};
type StatusRow = { code?: string; value?: string; desc?: string; data?: string | number };
type OrderRow = {
  id?: string;
  order_time?: string;
  order_code?: string;
  order_state?: string;
  price?: number | string;
  product_name?: string;
  products?: unknown;
  nums?: number | string;
  pay_type_raw?: string | null;
  refund_status?: string | null;
  machine_id?: string | null;
  machine_name?: string | null;
};
type Tool = { name: string; description: string; inputSchema: Record<string, unknown>; scope: Scope; roles?: Principal["role"][] };

class ToolError extends Error {
  constructor(message: string, readonly code = -32602) { super(message); }
}

const TOOLS: Tool[] = [
  { name: "list_machines", description: "List machines available to this SoftLife user, including connectivity and last-online timestamps.", scope: "read", inputSchema: { type: "object", properties: {} } },
  { name: "get_machine", description: "Get one authorized machine by its SoftLife UUID.", scope: "read", inputSchema: { type: "object", properties: { machine_id: { type: "string" } }, required: ["machine_id"] } },
  { name: "list_orders", description: "List authorized orders for a date range. Raw vendor and payment identifiers are excluded.", scope: "read", inputSchema: { type: "object", properties: { date_from: { type: "string", description: "YYYY-MM-DD" }, date_to: { type: "string", description: "YYYY-MM-DD" }, machine_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } } } },
  { name: "get_analytics", description: "Calculate completed net sales, units, order count, machine count, and top product combinations for an authorized date range.", scope: "read", inputSchema: { type: "object", properties: { date_from: { type: "string" }, date_to: { type: "string" }, machine_id: { type: "string" } } } },
  { name: "get_machine_products", description: "Get configured hopper ingredients for one authorized machine.", scope: "read", inputSchema: { type: "object", properties: { machine_id: { type: "string" } }, required: ["machine_id"] } },
  { name: "list_alerts", description: "List unresolved alerts for authorized machines.", scope: "read", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } } },
  { name: "get_inventory", description: "Get current positive effective Odoo lot balances for the warehouse assigned to an authorized machine at the action time.", scope: "read", inputSchema: { type: "object", properties: { machine_id: { type: "string" }, occurred_at: { type: "string", description: "Used for historical warehouse assignment and access; balances are current. Defaults to now." } }, required: ["machine_id"] } },
  { name: "get_machine_live_status", description: "Fetch current Huaxin status for an authorized machine and identify low-stock and compressor-overheat conditions.", scope: "read", inputSchema: { type: "object", properties: { machine_id: { type: "string" } }, required: ["machine_id"] } },
  { name: "get_machine_defrost_status", description: "Get the defrost schedule and recent audited cycles for an authorized machine.", scope: "read", inputSchema: { type: "object", properties: { machine_id: { type: "string" } }, required: ["machine_id"] } },
  { name: "list_sales_context_machines", description: "List only the names and IDs of machines available for sales-context analysis. Use an ID with get_sales_context.", scope: "sales_context", roles: ["admin", "franchisee"], inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "get_sales_context", description: "Compare daily net sales with historical weather and dated context notes for one authorized machine over at most 92 days. Use the structured evidence to investigate why sales changed; use your own research capabilities for external events.", scope: "sales_context", roles: ["admin", "franchisee"], inputSchema: { type: "object", additionalProperties: false, properties: { machine_id: { type: "string" }, date_from: { type: "string", description: "YYYY-MM-DD" }, date_to: { type: "string", description: "YYYY-MM-DD" } }, required: ["machine_id", "date_from", "date_to"] } },
  { name: "create_sales_note", description: "Record dated evidence that may explain sales, with an optional machine and HTTPS source. Use a unique UUID idempotency_key. Never present speculation as fact; include a source URL for externally researched claims.", scope: "sales_notes", roles: ["admin", "franchisee"], inputSchema: salesNoteSchema() },
  { name: "delete_sales_note", description: "Soft-delete an owned sales context note using its current revision. Requires explicit confirm=true.", scope: "sales_notes", roles: ["admin", "franchisee"], inputSchema: { type: "object", additionalProperties: false, properties: { note_id: { type: "string" }, expected_revision: { type: "integer", minimum: 1 }, confirm: { type: "boolean" } }, required: ["note_id", "expected_revision", "confirm"] } },
  { name: "create_action_report_draft", description: "Create an idempotent Action Report draft. This never confirms physical work.", scope: "forms", inputSchema: reportSchema(false) },
  { name: "update_action_report_draft", description: "Update an owned Action Report draft using its current revision.", scope: "forms", inputSchema: reportSchema(true) },
  { name: "get_action_report", description: "Get an owned Action Report with refill lines, incidents, attachment metadata, AI state, questions, and stock observations.", scope: "forms", inputSchema: { type: "object", properties: { report_id: { type: "string" } }, required: ["report_id"] } },
  { name: "get_action_report_draft", description: "Compatibility alias for get_action_report.", scope: "forms", inputSchema: { type: "object", properties: { report_id: { type: "string" } }, required: ["report_id"] } },
  { name: "create_action_report_image_upload", description: "Reserve a report image and return a two-hour Supabase signed upload endpoint. Upload the raw image bytes with PUT; never encode them as base64.", scope: "forms", inputSchema: { type: "object", properties: { report_id: { type: "string" }, mime_type: { type: "string", enum: Object.keys(ACTION_REPORT_PHOTO_TYPES) }, size_bytes: { type: "integer", minimum: 1, maximum: MAX_ACTION_REPORT_PHOTO_BYTES }, line_number: { type: ["integer", "null"], minimum: 1, maximum: 20 } }, required: ["report_id", "mime_type", "size_bytes"] } },
  { name: "complete_action_report_image_upload", description: "Validate a reserved image after its raw bytes have been uploaded and attach it to the Action Report.", scope: "forms", inputSchema: { type: "object", properties: { upload_id: { type: "string" } }, required: ["upload_id"] } },
  { name: "cancel_action_report_image_upload", description: "Cancel an incomplete Action Report image reservation and remove any uploaded private object.", scope: "forms", inputSchema: { type: "object", properties: { upload_id: { type: "string" } }, required: ["upload_id"] } },
  { name: "confirm_action_report", description: "Confirm the exact stored Action Report draft. Requires explicit confirm=true and the current revision.", scope: "forms", inputSchema: { type: "object", properties: { report_id: { type: "string" }, expected_revision: { type: "integer", minimum: 1 }, confirm: { type: "boolean", description: "Explicit authorization to confirm the physical report." } }, required: ["report_id", "expected_revision", "confirm"] } },
  { name: "disable_machine_sales", description: "Disable sales on an authorized machine. Requires explicit confirmation and a unique idempotency key.", scope: "commands", roles: ["admin", "franchisee"], inputSchema: commandSchema() },
  { name: "dispense_free_cup", description: "Physically dispense one free cup on an authorized machine. Requires explicit confirmation and a unique idempotency key. Never retry an ambiguous result.", scope: "commands", roles: ["admin", "franchisee"], inputSchema: commandSchema() },
];

function reportSchema(update: boolean) {
  const required = [update ? "report_id" : "machine_id", "occurred_at", "action_modes"];
  if (update) required.push("expected_revision");
  return {
    type: "object",
    properties: {
      idempotency_key: { type: "string", description: "A UUID unique to this report creation attempt." },
      ...(update ? {} : { client_uuid: { type: "string", description: "Compatibility alias for idempotency_key." } }),
      report_id: { type: "string" }, machine_id: { type: "string" }, occurred_at: { type: "string" },
      expected_revision: { type: "integer", minimum: 1 },
      action_modes: { type: "array", items: { type: "string", enum: VALID_MODES }, minItems: 1, maxItems: 3, uniqueItems: true },
      notes: { type: "string", maxLength: 5000 },
      cleaning: { type: "object", properties: { material_used: { type: ["boolean", "null"] }, water_buckets: { type: ["integer", "null"], minimum: 0, maximum: 20 } } },
      refill_lines: { type: "array", maxItems: 20, items: { type: "object", properties: { quantity: { type: ["number", "null"] }, unit: { type: "string", maxLength: 30 }, odoo_lot_id: { type: ["integer", "null"] }, lot_code: { type: ["string", "null"], maxLength: 200 }, product_name: { type: ["string", "null"], maxLength: 200 }, finished_bottle: { type: "boolean" }, left_unfinished_bottle: { type: "boolean" } } } },
      incident_ids: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string" } },
    },
    required,
    ...(update ? {} : { anyOf: [{ required: ["idempotency_key"] }, { required: ["client_uuid"] }] }),
  };
}

function commandSchema() {
  return { type: "object", properties: { machine_id: { type: "string" }, idempotency_key: { type: "string" }, confirm: { type: "boolean", description: "Explicit authorization for this physical action." } }, required: ["machine_id", "idempotency_key", "confirm"] };
}

function salesNoteSchema() {
  return { type: "object", additionalProperties: false, properties: {
    idempotency_key: { type: "string", description: "A UUID unique to this note." }, sales_date: { type: "string", description: "YYYY-MM-DD" },
    machine_id: { type: ["string", "null"], description: "Omit for portfolio-wide context." },
    category: { type: "string", enum: ["event", "promotion", "operations", "competition", "other"] },
    note: { type: "string", minLength: 1, maxLength: 2000 }, source_url: { type: ["string", "null"], maxLength: 1000, description: "Optional HTTPS evidence URL." },
  }, required: ["idempotency_key", "sales_date", "category", "note"] };
}

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeRole(value: unknown): Principal["role"] {
  return value === "admin" || value === "franchisee" ? value : "operator";
}

export function apiKeyFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    if (!authorization.startsWith("Bearer ") || authorization.slice(7).includes(" ")) return null;
    return authorization.slice(7);
  }
  return new URL(request.url).searchParams.get("key");
}

async function authenticate(request: Request, s: SupabaseClient): Promise<Principal> {
  const raw = apiKeyFromRequest(request);
  if (!raw) throw new ToolError("Authentication required", -32001);
  if (!raw.startsWith("sl_mcp_") || raw.length < 40) throw new ToolError("Invalid MCP key", -32001);
  const { data, error } = await s.from("mcp_api_keys")
    .select("id,profile_id,scopes,expires_at,profiles!inner(role,tenant_id,full_name)")
    .eq("key_hash", await sha256(raw)).is("revoked_at", null).maybeSingle();
  if (error || !data || (data.expires_at && Date.parse(data.expires_at) <= Date.now())) throw new ToolError("Invalid or expired MCP key", -32001);
  const profile = data.profiles as unknown as { role: string; tenant_id: string | null; full_name: string | null };
  await s.from("mcp_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  return { keyId: data.id, profileId: data.profile_id, role: normalizeRole(profile.role), tenantId: profile.tenant_id, name: profile.full_name ?? "SoftLife user", scopes: new Set((data.scopes as Scope[]) ?? ["read"]) };
}

function madridDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

async function machineIdsAt(s: SupabaseClient, principal: Principal, eventTime = new Date().toISOString()): Promise<string[] | null> {
  if (principal.role === "admin") return null;
  if (principal.role === "operator") {
    const { data, error } = await s.from("user_machine_assignments").select("machine_id").eq("user_id", principal.profileId).lte("starts_at", eventTime).or(`ends_at.is.null,ends_at.gte.${eventTime}`);
    if (error) throw error;
    const ids = [...new Set((data ?? []).map((row) => row.machine_id as string))];
    if (!ids.length) return [];
    const { data: machines, error: machineError } = await s.from("machines").select("id").in("id", ids).eq("deployed", true);
    if (machineError) throw machineError;
    return (machines ?? []).map((row) => row.id as string);
  }
  if (!principal.tenantId) return [];
  const day = madridDay(eventTime);
  const { data, error } = await s.from("machine_franchisee_assignments").select("machine_id,tenant_id,start_date").lte("start_date", day).or(`end_date.is.null,end_date.gte.${day}`).order("start_date", { ascending: false });
  if (error) throw error;
  const effective = new Map<string, string>();
  for (const assignment of data ?? []) if (!effective.has(assignment.machine_id)) effective.set(assignment.machine_id, assignment.tenant_id);
  const ids = [...effective].filter(([, tenantId]) => tenantId === principal.tenantId).map(([machineId]) => machineId);
  if (!ids.length) return [];
  const { data: machines, error: machineError } = await s.from("machines").select("id").in("id", ids).eq("deployed", true);
  if (machineError) throw machineError;
  return (machines ?? []).map((row) => row.id as string);
}

async function authorizedMachine(s: SupabaseClient, principal: Principal, machineId: unknown, deployedOnly = false) {
  if (typeof machineId !== "string" || !UUID.test(machineId)) throw new ToolError("Invalid machine_id");
  const ids = await machineIdsAt(s, principal);
  if (ids !== null && !ids.includes(machineId)) throw new ToolError("Machine not found", -32004);
  let query = s.from("machines").select("id,name,display_name,device_imei,location,is_online,last_online_at,offline_since,huaxin_last_sync,deployed,tenant_id,warehouse_id").eq("id", machineId);
  if (deployedOnly) query = query.eq("deployed", true);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new ToolError("Machine not found", -32004);
  return data;
}

function positiveLimit(value: unknown, fallback = 50) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100) throw new ToolError("limit must be an integer from 1 to 100");
  return Number(value);
}

function paymentCategory(value: string | null | undefined) {
  if (!value) return null;
  return PAYMENT_TYPES[value] ?? (Object.values(PAYMENT_TYPES).includes(value) ? value : "Other");
}

function dateRange(args: Record<string, unknown>) {
  const today = madridDay(new Date().toISOString());
  const defaultFrom = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const from = typeof args.date_from === "string" ? args.date_from : defaultFrom;
  const to = typeof args.date_to === "string" ? args.date_to : today;
  if (!validDay(from) || !validDay(to) || from > to || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86_400_000) throw new ToolError("Invalid date range");
  return { from, to };
}

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function salesContextRange(args: Record<string, unknown>) {
  if (typeof args.date_from !== "string" || typeof args.date_to !== "string") throw new ToolError("date_from and date_to are required");
  const range = dateRange(args);
  const today = madridDay(new Date().toISOString());
  if (range.to > today || Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`) > 91 * 86_400_000) throw new ToolError("Sales context supports at most 92 past or current days");
  return range;
}

export function salesNoteInput(args: Record<string, unknown>) {
  rejectUnknownArguments(args, ["idempotency_key", "sales_date", "machine_id", "category", "note", "source_url"]);
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : "";
  const salesDate = typeof args.sales_date === "string" ? args.sales_date : "";
  const category = typeof args.category === "string" ? args.category : "";
  const note = typeof args.note === "string" ? args.note.trim() : "";
  if (args.machine_id !== undefined && args.machine_id !== null && typeof args.machine_id !== "string") throw new ToolError("Invalid machine_id");
  if (args.source_url !== undefined && args.source_url !== null && typeof args.source_url !== "string") throw new ToolError("source_url must be a valid HTTPS URL");
  const machineId = args.machine_id === undefined || args.machine_id === null ? null : args.machine_id;
  let sourceUrl = args.source_url === undefined || args.source_url === null ? null : args.source_url.trim();
  if (!UUID.test(idempotencyKey) || !validDay(salesDate) || !["event", "promotion", "operations", "competition", "other"].includes(category) || !note || note.length > 2000) throw new ToolError("Invalid sales note");
  if (machineId !== null && !UUID.test(machineId)) throw new ToolError("Invalid machine_id");
  if (sourceUrl !== null) {
    try { const parsed = new URL(sourceUrl); if (sourceUrl.length > 1000 || parsed.protocol !== "https:") throw new Error(); sourceUrl = parsed.toString(); }
    catch { throw new ToolError("source_url must be a valid HTTPS URL"); }
  }
  return { idempotencyKey, salesDate, category, note, machineId, sourceUrl };
}

function rejectUnknownArguments(args: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(args).some((key) => !allowed.includes(key))) throw new ToolError("Unknown tool argument");
}

export function madridMidnightUtc(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const utcMidnight = Date.UTC(year, month - 1, date);
  const zoneName = new Intl.DateTimeFormat("en", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" })
    .formatToParts(new Date(utcMidnight)).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = zoneName.match(/^GMT([+-])(\d{2}):(\d{2})$/);
  const offset = match ? (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
  return new Date(utcMidnight - offset * 60_000).toISOString();
}

function nextDay(day: string) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function shiftMcpDay(day: string, amount: number) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86_400_000).toISOString().slice(0, 10);
}

async function scopedOrderQuery(s: SupabaseClient, principal: Principal, args: Record<string, unknown>, fields: string, maxRows = 100_000) {
  const range = dateRange(args);
  const rangeStart = madridMidnightUtc(range.from);
  const rangeEnd = madridMidnightUtc(nextDay(range.to));
  let machineId: string | null = null;
  if (args.machine_id !== undefined) {
    if (typeof args.machine_id !== "string" || !UUID.test(args.machine_id)) throw new ToolError("Invalid machine_id");
    machineId = args.machine_id;
  }
  const rows: OrderRow[] = [];
  let beforeTime: string | null = null;
  let beforeId: string | null = null;
  while (rows.length < maxRows) {
    const pageLimit = Math.min(1000, maxRows - rows.length);
    const { data, error } = await s.rpc("mcp_authorized_orders", {
      p_profile_id: principal.profileId, p_from: rangeStart, p_to: rangeEnd, p_machine_id: machineId,
      p_before_time: beforeTime, p_before_id: beforeId, p_limit: pageLimit,
    }).select(fields);
    if (error) throw error;
    const page = (data ?? []) as unknown as OrderRow[];
    rows.push(...page);
    if (page.length < pageLimit) return { data: rows, range };
    const last = page.at(-1);
    if (!last?.order_time || !last.id) throw new ToolError("Order pagination cursor is unavailable", -32603);
    beforeTime = last.order_time;
    beforeId = last.id;
  }
  if (maxRows === 100_000) throw new ToolError("Order range is too large; request a shorter date range");
  return { data: rows, range };
}

async function huaxinBridge(path: string, extra: Record<string, unknown>) {
  if (!BRIDGE_TOKEN) throw new ToolError("Live Huaxin access is not configured", -32603);
  const response = await fetch(BRIDGE_URL, { method: "POST", headers: { "content-type": "application/json", "x-defrost-bridge-token": BRIDGE_TOKEN }, body: JSON.stringify({ path, extra }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({})) as { code?: number; msg?: string; data?: unknown; error?: string };
  if (!response.ok) throw new ToolError(body.error ?? body.msg ?? "Huaxin request failed", -32603);
  return body;
}

async function captureReportStock(reportId: string, actorId: string) {
  if (!STOCK_BRIDGE_TOKEN) throw new ToolError("Stock snapshot capture is not configured", -32603);
  const response = await fetch(STOCK_BRIDGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-action-report-stock-token": STOCK_BRIDGE_TOKEN },
    body: JSON.stringify({ report_id: reportId, actor_id: actorId }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => ({})) as { id?: string; status?: string; duplicate?: boolean; error?: string };
  if (!response.ok) throw new ToolError(body.error ?? "Stock snapshot capture failed", -32603);
  return body;
}

type McpWeather = { day: string; temperature_mean: number; temperature_min: number; temperature_max: number; precipitation_mm: number; weather_code: number | null };

export function parseOpenMeteoDaily(payload: unknown): McpWeather[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const daily = (payload as { daily?: Record<string, unknown> }).daily;
  const times = daily?.time;
  const means = daily?.temperature_2m_mean;
  const maximums = daily?.temperature_2m_max;
  const minimums = daily?.temperature_2m_min;
  const precipitation = daily?.precipitation_sum;
  const codes = daily?.weather_code;
  if (!Array.isArray(times) || !Array.isArray(means) || !Array.isArray(maximums) || !Array.isArray(minimums) || !Array.isArray(precipitation) || !Array.isArray(codes)) return [];
  return times.flatMap((day, index) => {
    const mean = means[index]; const maximum = maximums[index]; const minimum = minimums[index]; const rain = precipitation[index]; const code = codes[index];
    return typeof day === "string" && validDay(day) && typeof mean === "number" && Number.isFinite(mean) && typeof maximum === "number" && Number.isFinite(maximum) && typeof minimum === "number" && Number.isFinite(minimum) && typeof rain === "number" && Number.isFinite(rain)
      ? [{ day, temperature_mean: mean, temperature_min: maximum < minimum ? maximum : minimum, temperature_max: maximum < minimum ? minimum : maximum, precipitation_mm: rain, weather_code: typeof code === "number" && Number.isInteger(code) ? code : null }]
      : [];
  });
}

export function completeWeatherSeries(rows: McpWeather[], start: string, end: string) {
  const expectedDays: string[] = [];
  for (let day = start; day <= end; day = nextDay(day)) expectedDays.push(day);
  return rows.length === expectedDays.length && rows.every((row, index) => row.day === expectedDays[index]);
}

async function fetchMcpWeather(latitude: number, longitude: number, from: string, to: string) {
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return { weather: [], error: "Machine coordinates are unavailable" };
  const today = madridDay(new Date().toISOString());
  const requests: Promise<McpWeather[]>[] = [];
  for (const [endpoint, start, end] of [
    ["https://archive-api.open-meteo.com/v1/archive", from, [to, shiftMcpDay(today, -5)].sort()[0]],
    ["https://api.open-meteo.com/v1/forecast", [from, shiftMcpDay(today, -4)].sort().at(-1)!, to],
  ] as const) {
    if (start > end) continue;
    const url = new URL(endpoint); url.searchParams.set("latitude", latitude.toFixed(4)); url.searchParams.set("longitude", longitude.toFixed(4)); url.searchParams.set("start_date", start); url.searchParams.set("end_date", end); url.searchParams.set("daily", "weather_code,temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum"); url.searchParams.set("timezone", "Europe/Madrid");
    requests.push(fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) }).then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || Number(response.headers.get("content-length") ?? 0) > 1_000_000) throw new Error("Weather provider failed");
      const rows = parseOpenMeteoDaily(await response.json());
      if (!completeWeatherSeries(rows, start, end)) throw new Error("Weather provider returned an incomplete daily series");
      return rows;
    }));
  }
  try {
    const weather = (await Promise.all(requests)).flat();
    return { weather, ...(weather.length ? {} : { error: "Weather is unavailable for this period" }) };
  } catch {
    return { weather: [], error: "Weather is unavailable for this period" };
  }
}

function normalized(value: unknown) { return String(value ?? "").trim().toLowerCase(); }
function isOpen(value: unknown) { return ["open", "on", "abrir", "开"].includes(normalized(value)); }
function statusValue(rows: StatusRow[], code: string) { const row = rows.find((item) => item.code === code); return row?.value ?? row?.data ?? null; }
export function isLowStock(rows: StatusRow[]) { const value = normalized(statusValue(rows, "status_0_lackmaterial")); return Boolean(value) && !["0", "false", "normal", "none", "available", "正常", "无"].includes(value); }
export function isOverheated(rows: StatusRow[]) { return isOpen(statusValue(rows, "status_0_overhot")) || /^113\b/.test(String(statusValue(rows, "status_0_code") ?? "")); }

function canonicalModes(value: unknown) {
  if (!Array.isArray(value)) throw new ToolError("action_modes must be an array");
  const modes = VALID_MODES.filter((mode) => value.includes(mode));
  if (!modes.length || modes.length !== value.length || new Set(value).size !== value.length) throw new ToolError("Invalid action_modes");
  return modes;
}

export function reportPayload(args: Record<string, unknown>, revision: number, status: "draft" | "confirmed") {
  const clientUuid = String(args.client_uuid ?? "");
  const machineId = String(args.machine_id ?? "");
  const occurredAt = String(args.occurred_at ?? "");
  if (!UUID.test(clientUuid) || !UUID.test(machineId) || !Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) < Date.parse("2020-01-01") || Date.parse(occurredAt) > Date.now() + 5 * 60_000) throw new ToolError("Invalid Action Report identifiers or time");
  const modes = canonicalModes(args.action_modes);
  const notes = String(args.notes ?? "").trim();
  if (notes.length > 5000) throw new ToolError("Notes exceed 5000 characters");
  const cleaning = args.cleaning && typeof args.cleaning === "object" && !Array.isArray(args.cleaning) ? args.cleaning as Record<string, unknown> : {};
  const materialUsed = typeof cleaning.material_used === "boolean" ? cleaning.material_used : null;
  const waterBuckets = cleaning.water_buckets === null || cleaning.water_buckets === undefined ? null : Number(cleaning.water_buckets);
  if (waterBuckets !== null && (!Number.isInteger(waterBuckets) || waterBuckets < 0 || waterBuckets > 20)) throw new ToolError("water_buckets must be an integer from 0 to 20");
  const rawLines = Array.isArray(args.refill_lines) ? args.refill_lines as Record<string, unknown>[] : [];
  if (rawLines.length > 20) throw new ToolError("A report supports at most 20 refill lines");
  const lines = modes.includes("refill") ? rawLines.map((line) => {
    const quantity = line.quantity === null || line.quantity === undefined ? null : Number(line.quantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) throw new ToolError("Refill quantities must be positive numbers");
    const unit = String(line.unit ?? "unit").slice(0, 30);
    const lotId = line.odoo_lot_id === null || line.odoo_lot_id === undefined ? null : Number(line.odoo_lot_id);
    if (lotId !== null && (!Number.isInteger(lotId) || lotId < 0)) throw new ToolError("Invalid odoo_lot_id");
    if (line.finished_bottle !== undefined && typeof line.finished_bottle !== "boolean") throw new ToolError("finished_bottle must be a boolean");
    if (line.left_unfinished_bottle !== undefined && typeof line.left_unfinished_bottle !== "boolean") throw new ToolError("left_unfinished_bottle must be a boolean");
    if ((line.finished_bottle === true || line.left_unfinished_bottle === true) && quantity !== null && !Number.isInteger(quantity)) throw new ToolError("Bottle-tracked refill quantities must be whole numbers");
    return { quantity, unit, odoo_lot_id: lotId, lot_code: String(line.lot_code ?? "").trim().slice(0, 200) || null, product_name: String(line.product_name ?? "").trim().slice(0, 200) || null, ...(line.finished_bottle === true ? { finished_bottle: true } : {}), ...(line.left_unfinished_bottle === true ? { left_unfinished_bottle: true } : {}) };
  }) : [];
  const incidentIds = Array.isArray(args.incident_ids) ? args.incident_ids.map(String) : [];
  if (incidentIds.length > 20 || new Set(incidentIds).size !== incidentIds.length || incidentIds.some((id) => !UUID.test(id))) throw new ToolError("Invalid incident_ids");
  if (status === "confirmed" && modes.includes("cleaning") && materialUsed === null) throw new ToolError("Cleaning material evidence is required before confirmation");
  if (status === "confirmed" && modes.includes("refill") && (!lines.length || lines.some((line) => line.quantity === null))) throw new ToolError("Valid refill lines are required before confirmation");
  if (status === "confirmed" && modes.includes("other") && !notes) throw new ToolError("Notes are required for other actions");
  const actionKind = modes.includes("cleaning") && modes.includes("refill") ? "both" : modes.includes("cleaning") ? "cleaning" : modes.includes("refill") ? "refill" : "other";
  const mobilePayload = { client_uuid: clientUuid, machine_id: machineId, occurred_at: new Date(occurredAt).toISOString(), status, revision, action_kind: actionKind, action_modes: modes, notes: notes || null, cleaning: { material_used: modes.includes("cleaning") ? materialUsed : null, water_buckets: modes.includes("cleaning") ? waterBuckets : null }, refill_lines: lines };
  return { clientUuid, machineId, occurredAt: mobilePayload.occurred_at, modes, actionKind, notes: notes || null, materialUsed, waterBuckets, lines, incidentIds, revision, mobilePayload };
}

async function persistReport(s: SupabaseClient, principal: Principal, args: Record<string, unknown>, revision: number, status: "draft" | "confirmed", rejectConfirmed = false, operatorId = principal.profileId) {
  const payload = reportPayload(args, revision, status);
  const currentIds = await machineIdsAt(s, principal);
  const eventIds = await machineIdsAt(s, principal, payload.occurredAt);
  if ((currentIds !== null && !currentIds.includes(payload.machineId)) || (eventIds !== null && !eventIds.includes(payload.machineId))) throw new ToolError("Machine not found", -32004);
  const { data: existing, error: existingError } = await s.from("service_action_reports").select("id,operator_id,status").eq("client_uuid", payload.clientUuid).maybeSingle();
  if (existingError) throw existingError;
  if (existing && principal.role !== "admin" && existing.operator_id !== principal.profileId) throw new ToolError("Action Report not found", -32004);
  if (rejectConfirmed && existing?.status !== undefined && existing.status !== "draft") throw new ToolError("Confirmed Action Reports cannot be edited", -32009);
  const canonicalLines = payload.lines.flatMap((line) => line.quantity === null ? [] : [{ ...line, quantity: line.quantity }]);
  const { data, error } = await s.rpc("record_revisioned_service_action_report", {
    p_client_uuid: payload.clientUuid, p_machine_id: payload.machineId, p_operator_id: operatorId, p_actor_id: principal.profileId,
    p_occurred_at: payload.occurredAt, p_status: status, p_notes: payload.notes,
    p_cleaning_material_used: payload.modes.includes("cleaning") ? payload.materialUsed : null,
    p_water_bucket_count: payload.modes.includes("cleaning") ? payload.waterBuckets : null,
    p_refill_lines: canonicalLines, p_source: "api", p_expected_revision: payload.revision,
    p_draft_payload: payload.mobilePayload, p_action_modes: payload.modes, p_incident_ids: payload.incidentIds,
  });
  if (error) {
    if (/revision conflict|conflicts with/i.test(error.message)) throw new ToolError("Action Report revision conflict", -32009);
    throw new ToolError(error.message);
  }
  return data;
}

async function getOwnedReport(s: SupabaseClient, principal: Principal, reportId: unknown) {
  if (typeof reportId !== "string" || !UUID.test(reportId)) throw new ToolError("Invalid report_id");
  const { data, error } = await s.from("service_action_reports")
    .select("id,client_uuid,machine_id,operator_id,tenant_id,occurred_at,action_kind,action_modes,status,notes,cleaning_material_used,water_bucket_count,source,assigned_warehouse_id,provenance_status,cleaning_projection_status,refill_projection_status,projection_error,confirmed_at,revision,mobile_draft_payload,created_at,updated_at,service_action_refill_lines(id,line_number,quantity,unit,observed_odoo_lot_id,observed_lot_code,product_name,finished_bottle,left_unfinished_bottle,inventory_quantity,provenance_status,unresolved_reason)")
    .eq("id", reportId).maybeSingle();
  if (error) throw error;
  if (!data || (principal.role !== "admin" && data.operator_id !== principal.profileId)) throw new ToolError("Action Report not found", -32004);
  const eventIds = await machineIdsAt(s, principal, data.occurred_at);
  if (eventIds !== null && !eventIds.includes(data.machine_id)) throw new ToolError("Action Report not found", -32004);
  if (data.status === "draft") {
    const currentIds = await machineIdsAt(s, principal);
    if (currentIds !== null && !currentIds.includes(data.machine_id)) throw new ToolError("Action Report not found", -32004);
  }
  return data;
}

export function actionReportImageInput(args: Record<string, unknown>) {
  const mimeType = typeof args.mime_type === "string" ? args.mime_type.split(";")[0].toLowerCase() : "";
  const sizeBytes = Number(args.size_bytes);
  const lineNumber = args.line_number === undefined || args.line_number === null ? null : Number(args.line_number);
  if (!ACTION_REPORT_PHOTO_TYPES[mimeType] || !Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ACTION_REPORT_PHOTO_BYTES) throw new ToolError("Unsupported Action Report image");
  if (lineNumber !== null && (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > 20)) throw new ToolError("Invalid refill line");
  return { mimeType, sizeBytes, lineNumber, extension: ACTION_REPORT_PHOTO_TYPES[mimeType] };
}

async function reserveActionReportImage(s: SupabaseClient, principal: Principal, args: Record<string, unknown>) {
  const report = await getOwnedReport(s, principal, args.report_id);
  if (report.status !== "draft" && report.status !== "confirmed") throw new ToolError("Action Report cannot accept images", -32009);
  await cleanupExpiredImageUploads(s);
  const image = actionReportImageInput(args);
  const folder = `${report.tenant_id ?? "platform"}/${report.id}/mcp-photo`;
  const path = `${folder}/${crypto.randomUUID()}.${image.extension}`;
  const { data: uploadId, error: reservationError } = await s.rpc("reserve_service_action_photo_upload", {
    p_report_id: report.id, p_actor_id: principal.profileId, p_storage_path: path,
    p_mime_type: image.mimeType, p_expected_size_bytes: image.sizeBytes, p_line_number: image.lineNumber,
  });
  if (reservationError) throw new ToolError(reservationError.message, reservationError.message.includes("limit") ? -32009 : -32602);
  const { data, error } = await s.storage.from(ACTION_REPORT_PHOTO_BUCKET).createSignedUploadUrl(path, { upsert: false });
  if (error || !data) {
    await s.rpc("cancel_service_action_photo_upload", { p_upload_id: uploadId, p_actor_id: principal.profileId });
    throw error ?? new Error("Signed upload endpoint was not created");
  }
  return {
    upload_id: uploadId, report_id: report.id, mime_type: image.mimeType, size_bytes: image.sizeBytes,
    upload_url: data.signedUrl, method: "PUT", headers: { "content-type": image.mimeType, "x-upsert": "false" }, expires_in_seconds: 7200,
    next_step: "PUT the raw image bytes to upload_url, then call complete_action_report_image_upload with upload_id. If abandoning the upload, call cancel_action_report_image_upload.",
  };
}

async function cleanupExpiredImageUploads(s: SupabaseClient) {
  const { data: expired, error } = await s.from("service_action_photo_uploads")
    .select("id,storage_path").is("completed_attachment_id", null).lte("expires_at", new Date().toISOString()).limit(100);
  if (error) throw error;
  for (const upload of expired ?? []) {
    const { error: removeError } = await s.storage.from(ACTION_REPORT_PHOTO_BUCKET).remove([upload.storage_path]);
    if (removeError) continue;
    const { error: deleteError } = await s.from("service_action_photo_uploads").delete().eq("id", upload.id).is("completed_attachment_id", null);
    if (deleteError) console.error("[softlife-mcp] Could not delete expired image reservation", deleteError);
  }
}

async function completeActionReportImage(s: SupabaseClient, principal: Principal, args: Record<string, unknown>) {
  if (typeof args.upload_id !== "string" || !UUID.test(args.upload_id)) throw new ToolError("Invalid upload_id");
  const { data: upload, error: uploadError } = await s.from("service_action_photo_uploads")
    .select("id,report_id,actor_id,storage_path,mime_type,expected_size_bytes,expires_at,completed_attachment_id")
    .eq("id", args.upload_id).maybeSingle();
  if (uploadError) throw uploadError;
  if (!upload || (principal.role !== "admin" && upload.actor_id !== principal.profileId)) throw new ToolError("Image upload reservation not found", -32004);
  await getOwnedReport(s, principal, upload.report_id);
  if (upload.completed_attachment_id) return { attachment_id: upload.completed_attachment_id, report_id: upload.report_id, duplicate: true };
  const { data: info, error: infoError } = await s.storage.from(ACTION_REPORT_PHOTO_BUCKET).info(upload.storage_path);
  if (infoError || !info) throw new ToolError("Uploaded image was not found. Upload the raw bytes before completing.");
  const sizeBytes = Number(info.size);
  const storedType = String(info.contentType ?? info.metadata?.mimetype ?? "").split(";")[0].toLowerCase();
  if (sizeBytes !== Number(upload.expected_size_bytes) || storedType !== upload.mime_type || Date.parse(upload.expires_at) <= Date.now()) {
    await discardReservedImage(s, principal, upload.id);
    throw new ToolError("Stored image does not match its reservation");
  }
  const { data: attachmentId, error } = await s.rpc("finalize_service_action_photo_upload", {
    p_upload_id: upload.id, p_actor_id: principal.profileId, p_storage_path: upload.storage_path,
    p_mime_type: upload.mime_type, p_size_bytes: sizeBytes,
  });
  if (error) {
    if (/reservation (does not match|not found|report revision changed)|refill line not found|Action Report not attachable/i.test(error.message)) {
      await discardReservedImage(s, principal, upload.id);
    }
    throw new ToolError(error.message);
  }
  return { attachment_id: attachmentId, report_id: upload.report_id, duplicate: false };
}

async function discardReservedImage(s: SupabaseClient, principal: Principal, uploadId: string) {
  const { data: path, error } = await s.rpc("cancel_service_action_photo_upload_retryable", { p_upload_id: uploadId, p_actor_id: principal.profileId });
  if (error) throw new ToolError(error.message, -32009);
  const { error: removeError } = await s.storage.from(ACTION_REPORT_PHOTO_BUCKET).remove([path]);
  if (removeError) throw removeError;
  const { error: deleteError } = await s.from("service_action_photo_uploads").delete().eq("id", uploadId).is("completed_attachment_id", null);
  if (deleteError) throw deleteError;
}

async function cancelActionReportImage(s: SupabaseClient, principal: Principal, args: Record<string, unknown>) {
  if (typeof args.upload_id !== "string" || !UUID.test(args.upload_id)) throw new ToolError("Invalid upload_id");
  const { data: upload, error: uploadError } = await s.from("service_action_photo_uploads").select("report_id,actor_id").eq("id", args.upload_id).maybeSingle();
  if (uploadError) throw uploadError;
  if (!upload || (principal.role !== "admin" && upload.actor_id !== principal.profileId)) throw new ToolError("Image upload reservation not found", -32004);
  await getOwnedReport(s, principal, upload.report_id);
  await discardReservedImage(s, principal, args.upload_id);
  return { cancelled: true, report_id: upload.report_id };
}

async function getReportDetails(s: SupabaseClient, principal: Principal, reportId: unknown) {
  const report = await getOwnedReport(s, principal, reportId);
  const [{ data: incidentLinks, error: incidentError }, { data: attachments, error: attachmentError }, { data: aiJob, error: aiError }, { data: questions, error: questionError }, { data: snapshot, error: snapshotError }] = await Promise.all([
    s.from("service_action_report_incidents").select("closes_incident,incidents(id,title,status,severity,incident_type)").eq("report_id", report.id),
    s.from("service_action_attachments").select("id,refill_line_id,kind,mime_type,size_bytes,created_at").eq("report_id", report.id).order("created_at"),
    s.from("service_action_ai_jobs").select("id,attachment_id,status,attempt_count,transcript_text,transcript_language,duration_seconds,extraction,schema_version,last_error,reviewed_at,created_at,updated_at").eq("report_id", report.id).maybeSingle(),
    s.from("service_action_questions").select("id,question,status,source,ai_job_id,created_at").eq("report_id", report.id).order("created_at"),
    s.from("service_action_stock_snapshots").select("id,report_occurred_at,captured_at,status,source,service_action_stock_snapshot_items(menu_kind,position,goods_name_raw,stock_raw,stock_count,enabled,platform_product_id,mapping_method)").eq("report_id", report.id).maybeSingle(),
  ]);
  if (incidentError || attachmentError || aiError || questionError || snapshotError) throw incidentError ?? attachmentError ?? aiError ?? questionError ?? snapshotError;
  return { ...report, incidents: incidentLinks ?? [], attachments: attachments ?? [], ai_job: aiJob, questions: questions ?? [], stock_snapshot: snapshot };
}

async function commandsFor(s: SupabaseClient, principal: Principal) {
  if (principal.role === "admin") return new Set(["operate_sellout", "operate_make"]);
  if (principal.role !== "franchisee" || !principal.tenantId) return new Set<string>();
  const { data, error } = await s.from("tenants").select("remote_commands").eq("id", principal.tenantId).maybeSingle();
  if (error) throw error;
  const configured = new Set((data?.remote_commands as string[] | null) ?? ["operate_make"]);
  return new Set(["operate_sellout", "operate_make"].filter((command) => configured.has(command)));
}

async function updateCommand(s: SupabaseClient, id: string, values: Record<string, unknown>) {
  const { error } = await s.from("mcp_command_requests").update(values).eq("id", id);
  if (error) throw error;
}

async function recordCommandOutcome(s: SupabaseClient, requestId: string, state: "accepted" | "rejected" | "ambiguous", values: { code?: string; message?: string; error?: string; details?: Record<string, unknown> } = {}) {
  const { error } = await s.rpc("record_mcp_command_outcome", {
    p_request_id: requestId, p_state: state, p_huaxin_code: values.code ?? null,
    p_message: values.message ?? null, p_error_detail: values.error ?? null, p_details: values.details ?? {},
  });
  if (error) throw error;
}

async function executeCommand(s: SupabaseClient, principal: Principal, args: Record<string, unknown>, command: "operate_sellout" | "operate_make") {
  if (args.confirm !== true) throw new ToolError("Explicit confirm=true is required for this physical command");
  if (typeof args.idempotency_key !== "string" || !UUID.test(args.idempotency_key)) throw new ToolError("A UUID idempotency_key is required");
  const machine = await authorizedMachine(s, principal, args.machine_id, true);
  if (!machine.device_imei) throw new ToolError("Machine is not available for remote control");
  if (!(await commandsFor(s, principal)).has(command)) throw new ToolError("Command is not permitted", -32003);
  const requestHash = await sha256(JSON.stringify({ machine_id: machine.id, command }));
  const { data: existing, error: existingError } = await s.from("mcp_command_requests").select("state,request_hash,huaxin_code,huaxin_message,error_detail,completed_at").eq("key_id", principal.keyId).eq("idempotency_key", args.idempotency_key).maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (existing.request_hash !== requestHash) throw new ToolError("Idempotency key conflicts with another command", -32009);
    if (existing.state === "pending" || existing.state === "sending" || existing.state === "ambiguous") throw new ToolError("The prior command result is ambiguous. Do not retry automatically.", -32009);
    if (existing.state === "rejected") throw new ToolError(existing.error_detail ?? existing.huaxin_message ?? "Command was rejected", -32009);
    return { duplicate: true, state: existing.state, code: existing.huaxin_code, message: existing.huaxin_message, completed_at: existing.completed_at };
  }
  const { data: requestRow, error: insertError } = await s.from("mcp_command_requests").insert({ key_id: principal.keyId, actor_id: principal.profileId, idempotency_key: args.idempotency_key, request_hash: requestHash, machine_id: machine.id, command }).select("id").single();
  if (insertError || !requestRow) throw insertError ?? new ToolError("Could not create command request", -32603);
  const owner = crypto.randomUUID();
  const providerSerial = String(Date.now());
  let leased = false;
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
    const { count: hourlyKeyCount, error: keyRateError } = await s.from("mcp_command_requests").select("id", { count: "exact", head: true }).eq("key_id", principal.keyId).gte("created_at", oneHourAgo).in("state", ["pending", "sending", "accepted"]);
    if (keyRateError) throw keyRateError;
    if ((hourlyKeyCount ?? 0) > 20) throw new ToolError("Command rate limit exceeded", -32009);
    if (command === "operate_make") {
      const [{ count: hourlyMachineCount, error: hourlyMachineError }, { count: cooldownCount, error: cooldownError }] = await Promise.all([
        s.from("mcp_command_requests").select("id", { count: "exact", head: true }).eq("machine_id", machine.id).eq("command", command).gte("created_at", oneHourAgo).in("state", ["pending", "sending", "accepted"]),
        s.from("mcp_command_requests").select("id", { count: "exact", head: true }).eq("machine_id", machine.id).eq("command", command).gte("created_at", twoMinutesAgo).in("state", ["sending", "accepted"]),
      ]);
      if (hourlyMachineError || cooldownError) throw hourlyMachineError ?? cooldownError;
      if ((hourlyMachineCount ?? 0) > 3 || (cooldownCount ?? 0) > 0) throw new ToolError("Free cup rate limit exceeded", -32009);
    }
    const { data: activeDefrost, error: defrostError } = await s.from("machine_defrost_runs").select("id").eq("machine_id", machine.id).in("state", ACTIVE_DEFROST_STATES).limit(1).maybeSingle();
    if (defrostError) throw defrostError;
    if (activeDefrost && command !== "operate_sellout") throw new ToolError("Command blocked by active defrost", -32009);
    if (command === "operate_make") {
      const statusBody = await huaxinBridge("/machine/cloud/api/device/configure/status/detail", { device_imei: machine.device_imei });
      const statuses = (statusBody.data as StatusRow[] | null) ?? [];
      if (isLowStock(statuses) || isOverheated(statuses)) throw new ToolError("Free cup is blocked while low stock or compressor overheat is active", -32009);
      const { data: claimed, error: claimError } = await s.rpc("claim_interactive_machine_command", { p_machine_id: machine.id, p_owner: owner });
      if (claimError) throw claimError;
      if (!claimed) throw new ToolError("Command blocked by active workflow or unresolved intervention", -32009);
      leased = true;
    }
    await updateCommand(s, requestRow.id, { state: "sending", provider_serial: providerSerial, sent_at: new Date().toISOString() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await recordCommandOutcome(s, requestRow.id, "rejected", { error: detail, details: { error: detail, stage: "preflight" } });
    if (leased) {
      const { error: releaseError } = await s.rpc("release_interactive_machine_command", { p_machine_id: machine.id, p_owner: owner });
      if (releaseError) console.error("[softlife-mcp] Could not release rejected command lease", releaseError);
      leased = false;
    }
    throw error instanceof ToolError ? error : new ToolError("Command preflight failed before anything was sent", -32603);
  }
  let providerRejected = false;
  try {
    const body = await huaxinBridge("/machine/cloud/api/remote/control/data", { device_imei: machine.device_imei, data: { serialNum: providerSerial, type: "operate", deviceImei: machine.device_imei, data: { command, value: "1" } } });
    const accepted = String(body.code) === "200";
    const completedAt = new Date().toISOString();
    const message = body.msg ?? (accepted ? "success" : "Command rejected");
    await recordCommandOutcome(s, requestRow.id, accepted ? "accepted" : "rejected", { code: String(body.code ?? ""), message, error: accepted ? undefined : message, details: { code: body.code, message } });
    if (!accepted) {
      providerRejected = true;
      throw new ToolError(message, -32603);
    }
    return { duplicate: false, state: "accepted", code: String(body.code), message, completed_at: completedAt };
  } catch (error) {
    if (providerRejected) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    try {
      await recordCommandOutcome(s, requestRow.id, "ambiguous", { error: detail, details: { error: detail, provider_serial: providerSerial } });
    } catch (persistenceError) {
      console.error("[softlife-mcp] Could not persist ambiguous command outcome", persistenceError);
    }
    throw new ToolError("The command could not be confirmed. Do not retry automatically.", -32009);
  } finally {
    if (leased) {
      const { error } = await s.rpc("release_interactive_machine_command", { p_machine_id: machine.id, p_owner: owner });
      if (error) console.error("[softlife-mcp] Could not release interactive command lease", error);
    }
  }
}

async function handleTool(name: string, args: Record<string, unknown>, principal: Principal, s: SupabaseClient) {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) throw new ToolError("Unknown tool");
  if (!principal.scopes.has(tool.scope) || (tool.roles && !tool.roles.includes(principal.role))) throw new ToolError("Tool is not permitted for this key", -32003);
  switch (name) {
    case "list_machines": {
      const ids = await machineIdsAt(s, principal);
      if (ids?.length === 0) return [];
      let query = s.from("machines").select("id,name,display_name,device_imei,location,is_online,last_online_at,offline_since,huaxin_last_sync,deployed").order("name");
      if (ids) query = query.in("id", ids);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    }
    case "get_machine": return authorizedMachine(s, principal, args.machine_id);
    case "list_orders": {
      const limit = positiveLimit(args.limit);
      const { data, range } = await scopedOrderQuery(s, principal, args, "id,order_time,order_code,order_state,price,product_name,products,nums,pay_type_raw,refund_status,machine_id,machine_name,tenant_id", limit);
      return { range, orders: data.map((row) => ({ id: row.id, order_time: row.order_time, order_code: row.order_code, state: row.order_state, price: row.price, product_name: row.product_name, products: row.products, units: row.nums, payment_type: paymentCategory(row.pay_type_raw), refunded: row.refund_status === "Refunded", machine_id: row.machine_id, machine_name: row.machine_name })) };
    }
    case "get_analytics": {
      const { data, range } = await scopedOrderQuery(s, principal, args, "id,order_time,order_state,price,product_name,products,nums,pay_type_raw,refund_status,machine_id");
      const sales = data.filter((row) => row.order_state === "COMPLETE" && row.refund_status !== "Refunded" && !(typeof row.pay_type_raw === "string" && ADMIN_OVERRIDE_PAY_TYPES.has(row.pay_type_raw)));
      const combinations = new Map<string, number>();
      for (const row of sales) {
        const products = Array.isArray(row.products) ? row.products as { goodsName?: string }[] : [];
        const name = (products.length ? products.map((item) => item.goodsName).filter(Boolean) : [row.product_name]).sort().join(" + ") || "Unknown";
        combinations.set(name, (combinations.get(name) ?? 0) + Number(row.nums ?? 1));
      }
      const ids = new Set(sales.map((row) => row.machine_id).filter(Boolean));
      return { range, completed_orders: sales.length, units: sales.reduce((sum, row) => sum + Number(row.nums ?? 1), 0), net_sales: Number(sales.reduce((sum, row) => sum + Number(row.price ?? 0), 0).toFixed(2)), selling_machines: ids.size, top_combinations: [...combinations].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([products, units]) => ({ products, units })) };
    }
    case "get_machine_products": {
      const machine = await authorizedMachine(s, principal, args.machine_id);
      const { data, error } = await s.from("machine_ingredients").select("position,product_type,enabled,products(name,type,price)").eq("machine_id", machine.id).order("position");
      if (error) throw error;
      return data ?? [];
    }
    case "list_alerts": {
      const ids = await machineIdsAt(s, principal);
      if (ids?.length === 0) return [];
      let query = s.from("alerts").select("id,type,severity,title,message,created_at,machine_id,machines(name,display_name,device_imei)").is("resolved_at", null).order("created_at", { ascending: false }).limit(positiveLimit(args.limit));
      if (ids) query = query.in("machine_id", ids);
      if (principal.role === "franchisee") query = query.eq("tenant_id", principal.tenantId);
      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    }
    case "get_inventory": {
      const occurredAt = args.occurred_at === undefined ? new Date().toISOString() : String(args.occurred_at);
      if (!Number.isFinite(Date.parse(occurredAt)) || Date.parse(occurredAt) < Date.parse("2020-01-01") || Date.parse(occurredAt) > Date.now() + 5 * 60_000) throw new ToolError("Invalid occurred_at");
      const machine = await authorizedMachine(s, principal, args.machine_id, true);
      const eventIds = await machineIdsAt(s, principal, occurredAt);
      if (eventIds !== null && !eventIds.includes(machine.id)) throw new ToolError("Machine not found", -32004);
      const { data: assignment, error: assignmentError } = await s.from("machine_warehouse_assignments")
        .select("odoo_warehouse_id").eq("machine_id", machine.id).lte("valid_from", occurredAt)
        .or(`valid_to.is.null,valid_to.gt.${occurredAt}`).order("valid_from", { ascending: false }).limit(1).maybeSingle();
      if (assignmentError) throw assignmentError;
      if (!assignment) return { machine_id: machine.id, occurred_at: occurredAt, warehouse: null, lots: [] };
      const [{ data: balances, error: balanceError }, { data: warehouse, error: warehouseError }] = await Promise.all([
        s.from("warehouse_lot_effective_balances").select("odoo_lot_id,effective_quantity").eq("odoo_warehouse_id", assignment.odoo_warehouse_id).gt("effective_quantity", 0).limit(1000),
        s.from("odoo_warehouses").select("odoo_id,name,code").eq("odoo_id", assignment.odoo_warehouse_id).maybeSingle(),
      ]);
      if (balanceError || warehouseError) throw balanceError ?? warehouseError;
      const lotIds = (balances ?? []).map((row) => row.odoo_lot_id as number);
      const { data: lots, error: lotError } = lotIds.length
        ? await s.from("odoo_lots").select("odoo_id,name,product_name,expiration_date").in("odoo_id", lotIds)
        : { data: [], error: null };
      if (lotError) throw lotError;
      const balanceByLot = new Map((balances ?? []).map((row) => [row.odoo_lot_id as number, Number(row.effective_quantity)]));
      return {
        machine_id: machine.id,
        occurred_at: new Date(occurredAt).toISOString(),
        balance_as_of: new Date().toISOString(),
        warehouse,
        lots: (lots ?? []).map((lot) => ({ odoo_lot_id: lot.odoo_id, lot_code: lot.name, product_name: lot.product_name, expiration_date: lot.expiration_date, effective_quantity: balanceByLot.get(lot.odoo_id) ?? 0 }))
          .sort((a, b) => String(a.expiration_date ?? "9999").localeCompare(String(b.expiration_date ?? "9999")) || a.lot_code.localeCompare(b.lot_code)),
      };
    }
    case "get_machine_live_status": {
      const machine = await authorizedMachine(s, principal, args.machine_id, true);
      if (!machine.device_imei) throw new ToolError("Machine has no Huaxin IMEI");
      const body = await huaxinBridge("/machine/cloud/api/device/configure/status/detail", { device_imei: machine.device_imei });
      const rows = (body.data as StatusRow[] | null) ?? [];
      return { machine_id: machine.id, observed_at: new Date().toISOString(), online: normalized(statusValue(rows, "status_0_online_status")) === "online", low_stock: isLowStock(rows), compressor_overheat: isOverheated(rows), statuses: rows.map((row) => ({ code: row.code, label: row.desc ?? row.code, value: row.value ?? row.data ?? null })) };
    }
    case "get_machine_defrost_status": {
      const machine = await authorizedMachine(s, principal, args.machine_id);
      const [{ data: schedule, error: scheduleError }, { data: runs, error: runsError }] = await Promise.all([s.from("machine_defrost_schedules").select("enabled,local_start_time,time_zone,defrost_seconds,formation_timeout_seconds,requires_intervention").eq("machine_id", machine.id).maybeSingle(), s.from("machine_defrost_runs").select("id,state,trigger_kind,scheduled_for,started_at,completed_at,last_formation_pct,refrigeration_attempts,sales_attempts,failure_detail,outcome").eq("machine_id", machine.id).order("scheduled_for", { ascending: false }).limit(10)]);
      if (scheduleError || runsError) throw scheduleError ?? runsError;
      return { machine_id: machine.id, schedule, runs: runs ?? [] };
    }
    case "list_sales_context_machines": {
      rejectUnknownArguments(args, []);
      const ids = await machineIdsAt(s, principal);
      if (ids?.length === 0) return [];
      let query = s.from("machines").select("id,name,display_name").eq("deployed", true).order("name");
      if (ids) query = query.in("id", ids);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((machine) => ({ id: machine.id, name: machine.display_name ?? machine.name }));
    }
    case "get_sales_context": {
      rejectUnknownArguments(args, ["machine_id", "date_from", "date_to"]);
      const range = salesContextRange(args);
      const machine = await authorizedMachine(s, principal, args.machine_id, true);
      const [{ data: orders }, coordinates, notes, assignments] = await Promise.all([
        scopedOrderQuery(s, principal, { ...args, machine_id: machine.id }, "id,order_time,order_state,price,nums,pay_type_raw,refund_status,machine_id"),
        s.from("machines").select("latitude,longitude").eq("id", machine.id).single(),
        s.rpc("read_sales_context_notes", { p_actor_id: principal.profileId, p_from: range.from, p_to: range.to, p_machine_id: machine.id }),
        s.from("machine_franchisee_assignments").select("tenant_id,start_date,end_date").eq("machine_id", machine.id).order("start_date", { ascending: false }),
      ]);
      if (coordinates.error || notes.error || assignments.error) throw coordinates.error ?? notes.error ?? assignments.error;
      const assignmentRows = (assignments.data ?? []) as { tenant_id: string; start_date: string; end_date: string | null }[];
      const authorizedDays = new Set<string>();
      for (let day = range.from; day <= range.to; day = nextDay(day)) {
        const effectiveTenant = assignmentRows.find((assignment) => assignment.start_date <= day && (!assignment.end_date || assignment.end_date >= day))?.tenant_id ?? (assignmentRows.length ? null : machine.tenant_id);
        if (principal.role === "admin" || (!!principal.tenantId && effectiveTenant === principal.tenantId)) authorizedDays.add(day);
      }
      const salesByDay = new Map<string, { net_sales: number; orders: number; units: number }>();
      for (const row of orders) {
        if (row.order_state !== "COMPLETE" || row.refund_status === "Refunded" || (typeof row.pay_type_raw === "string" && ADMIN_OVERRIDE_PAY_TYPES.has(row.pay_type_raw))) continue;
        const day = madridDay(String(row.order_time));
        const daily = salesByDay.get(day) ?? { net_sales: 0, orders: 0, units: 0 };
        daily.net_sales += Number(row.price ?? 0); daily.orders++; daily.units += Number(row.nums ?? 1); salesByDay.set(day, daily);
      }
      const dailySales = [];
      for (let day = range.from; day <= range.to; day = nextDay(day)) {
        if (!authorizedDays.has(day)) continue;
        const daily = salesByDay.get(day) ?? { net_sales: 0, orders: 0, units: 0 };
        dailySales.push({ day, ...daily, net_sales: Number(daily.net_sales.toFixed(2)) });
      }
      const weatherResult = await fetchMcpWeather(coordinates.data.latitude === null ? NaN : Number(coordinates.data.latitude), coordinates.data.longitude === null ? NaN : Number(coordinates.data.longitude), range.from, range.to);
      const weather = { ...weatherResult, weather: weatherResult.weather.filter((row) => authorizedDays.has(row.day)) };
      return {
        machine: { id: machine.id, name: machine.display_name ?? machine.name }, range, daily_sales: dailySales,
        weather: { provider: "Open-Meteo", location_basis: "Current machine coordinates", ...weather }, notes: notes.data ?? [],
        guidance: "Compare day-level changes and use note sources as evidence. Correlation does not establish causation; use external research tools available to your client for local events and record sourced findings with create_sales_note.",
      };
    }
    case "create_sales_note": {
      const input = salesNoteInput(args);
      const { data, error } = await s.rpc("create_sales_context_note", {
        p_actor_id: principal.profileId, p_client_uuid: input.idempotencyKey, p_sales_date: input.salesDate,
        p_category: input.category, p_body: input.note, p_source_url: input.sourceUrl, p_machine_id: input.machineId,
      });
      if (error) {
        if (/idempotency key conflicts/i.test(error.message)) throw new ToolError("Sales note idempotency conflict", -32009);
        throw new ToolError(error.message);
      }
      return data;
    }
    case "delete_sales_note": {
      rejectUnknownArguments(args, ["note_id", "expected_revision", "confirm"]);
      if (args.confirm !== true) throw new ToolError("Explicit confirm=true is required");
      if (typeof args.note_id !== "string" || !UUID.test(args.note_id)) throw new ToolError("Invalid note_id");
      if (typeof args.expected_revision !== "number") throw new ToolError("expected_revision must be a positive integer");
      const revision = args.expected_revision;
      if (!Number.isInteger(revision) || revision < 1) throw new ToolError("expected_revision must be a positive integer");
      const { data, error } = await s.rpc("delete_sales_context_note", { p_actor_id: principal.profileId, p_note_id: args.note_id, p_expected_revision: revision, p_confirm: true });
      if (error) {
        if (/revision conflict/i.test(error.message)) throw new ToolError("Sales note revision conflict", -32009);
        if (/not found/i.test(error.message)) throw new ToolError("Sales note not found", -32004);
        throw new ToolError(error.message);
      }
      return data;
    }
    case "create_action_report_draft": {
      const idempotencyKey = args.idempotency_key ?? args.client_uuid;
      if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) throw new ToolError("A UUID idempotency_key is required");
      if (args.idempotency_key !== undefined && args.client_uuid !== undefined && args.idempotency_key !== args.client_uuid) throw new ToolError("idempotency_key and client_uuid must match");
      return persistReport(s, principal, { ...args, client_uuid: idempotencyKey }, 0, "draft");
    }
    case "update_action_report_draft": {
      const revision = Number(args.expected_revision);
      if (!Number.isInteger(revision) || revision < 1) throw new ToolError("expected_revision must be a positive integer");
      const report = await getOwnedReport(s, principal, args.report_id);
      if (principal.role !== "admin" && report.operator_id !== principal.profileId) throw new ToolError("Action Report not found", -32004);
      if (report.status !== "draft") throw new ToolError("Confirmed Action Reports cannot be edited", -32009);
      return persistReport(s, principal, { ...args, client_uuid: report.client_uuid }, revision, "draft", true, report.operator_id);
    }
    case "get_action_report":
    case "get_action_report_draft": return getReportDetails(s, principal, args.report_id);
    case "create_action_report_image_upload": return reserveActionReportImage(s, principal, args);
    case "complete_action_report_image_upload": return completeActionReportImage(s, principal, args);
    case "cancel_action_report_image_upload": return cancelActionReportImage(s, principal, args);
    case "confirm_action_report": {
      if (args.confirm !== true) throw new ToolError("Explicit confirm=true is required");
      const revision = Number(args.expected_revision);
      if (!Number.isInteger(revision) || revision < 1) throw new ToolError("expected_revision must be a positive integer");
      const report = await getReportDetails(s, principal, args.report_id);
      if (principal.role !== "admin" && report.operator_id !== principal.profileId) throw new ToolError("Action Report not found", -32004);
      if (report.status !== "draft" && report.status !== "confirmed") throw new ToolError("Action Report cannot be confirmed", -32009);
      const lines = ((report.service_action_refill_lines as Record<string, unknown>[]) ?? []).sort((a, b) => Number(a.line_number) - Number(b.line_number));
      const incidentIds = ((report.incidents as { incidents?: { id?: string } | null }[]) ?? []).flatMap((link) => link.incidents?.id ? [link.incidents.id] : []);
      const result = await persistReport(s, principal, {
        client_uuid: report.client_uuid,
        machine_id: report.machine_id,
        occurred_at: report.occurred_at,
        action_modes: report.action_modes,
        notes: report.notes,
        cleaning: { material_used: report.cleaning_material_used, water_buckets: report.water_bucket_count },
        refill_lines: lines.map((line) => ({ quantity: line.quantity, unit: line.unit, odoo_lot_id: line.observed_odoo_lot_id, lot_code: line.observed_lot_code, product_name: line.product_name, ...(line.finished_bottle === true ? { finished_bottle: true } : {}), ...(line.left_unfinished_bottle === true ? { left_unfinished_bottle: true } : {}) })),
        incident_ids: incidentIds,
      }, revision, "confirmed", false, report.operator_id);
      if (!report.action_modes.includes("refill")) return { ...(result as Record<string, unknown>), stock_snapshot_status: "not_applicable" };
      try {
        const snapshot = await captureReportStock(report.id, principal.profileId);
        return { ...(result as Record<string, unknown>), stock_snapshot_status: snapshot.status, stock_snapshot_id: snapshot.id };
      } catch (error) {
        return { ...(result as Record<string, unknown>), stock_snapshot_status: "failed", warning: error instanceof Error ? error.message : String(error) };
      }
    }
    case "disable_machine_sales": return executeCommand(s, principal, args, "operate_sellout");
    case "dispense_free_cup": return executeCommand(s, principal, args, "operate_make");
    default: throw new ToolError("Unknown tool");
  }
}

export function availableTools(principal: Principal) {
  return TOOLS.filter((tool) => principal.scopes.has(tool.scope) && (!tool.roles || tool.roles.includes(principal.role)))
    .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  const headers = new Headers({ "MCP-Protocol-Version": MCP_PROTOCOL_VERSION });
  if (status === 401) headers.set("WWW-Authenticate", "Bearer");
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status, headers });
}

function resultPayload(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function errorPayload(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function dispatchMessage(message: unknown, principal: Principal, s: SupabaseClient, inBatch = false): Promise<Record<string, unknown> | null> {
  if (!message || typeof message !== "object" || Array.isArray(message)) return errorPayload(null, -32600, "Invalid JSON-RPC request");
  const request = message as Record<string, unknown>;
  const id = request.id;
  if (request.jsonrpc !== "2.0") return errorPayload(id, -32600, "Invalid JSON-RPC request");
  if (typeof request.method !== "string") {
    if (Object.hasOwn(request, "id") && (Object.hasOwn(request, "result") || Object.hasOwn(request, "error"))) return null;
    return errorPayload(id, -32600, "Invalid JSON-RPC request");
  }
  if (!Object.hasOwn(request, "id")) return null;
  if (inBatch && request.method === "initialize") return errorPayload(id, -32600, "initialize cannot be batched");
  if (request.method === "initialize") {
    const params = request.params;
    if (!params || typeof params !== "object" || Array.isArray(params)) return errorPayload(id, -32602, "Invalid initialize parameters");
    const initialize = params as Record<string, unknown>;
    const clientInfo = initialize.clientInfo as Record<string, unknown> | null;
    if (typeof initialize.protocolVersion !== "string" || !initialize.capabilities || typeof initialize.capabilities !== "object" || Array.isArray(initialize.capabilities)
      || !clientInfo || typeof clientInfo !== "object" || typeof clientInfo.name !== "string" || typeof clientInfo.version !== "string") {
      return errorPayload(id, -32602, "Invalid initialize parameters");
    }
    const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.has(initialize.protocolVersion) ? initialize.protocolVersion : MCP_PROTOCOL_VERSION;
    return resultPayload(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "softlife-mcp", version: "3.4.0" } });
  }
  if (request.method === "tools/list") return resultPayload(id, { tools: availableTools(principal) });
  if (request.method !== "tools/call") return errorPayload(id, -32601, `Method not found: ${request.method}`);
  const params = request.params;
  if (!params || typeof params !== "object" || Array.isArray(params) || typeof (params as Record<string, unknown>).name !== "string") return errorPayload(id, -32602, "Invalid tool call");
  const name = (params as Record<string, unknown>).name as string;
  const rawArgs = (params as Record<string, unknown>).arguments;
  const args = rawArgs === undefined ? {} : rawArgs;
  if (!args || typeof args !== "object" || Array.isArray(args)) return errorPayload(id, -32602, "Invalid tool arguments");
  try {
    const data = await handleTool(name, args as Record<string, unknown>, principal, s);
    return resultPayload(id, { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data });
  } catch (error) {
    const code = error instanceof ToolError ? error.code : -32603;
    const message = error instanceof ToolError ? error.message : "SoftLife tool failed";
    if (!(error instanceof ToolError)) console.error("[softlife-mcp] Tool failed", error);
    if (code === -32602 || code === -32003 || code === -32004 || code === -32009) return errorPayload(id, code, message);
    return resultPayload(id, { content: [{ type: "text", text: message }], isError: true });
  }
}

export async function handleRequest(request: Request) {
  const origin = request.headers.get("origin");
  const allowedOrigins = (Deno.env.get("MCP_ALLOWED_ORIGINS")?.split(",").map((value) => value.trim()).filter(Boolean) ?? DEFAULT_ALLOWED_ORIGINS);
  if (origin && !allowedOrigins.includes(origin)) return rpcError(null, -32003, "Origin is not allowed", 403);
  if (request.method !== "POST") return rpcError(null, -32600, "POST required", 405);
  const requestedProtocol = request.headers.get("mcp-protocol-version");
  if (requestedProtocol && !SUPPORTED_PROTOCOL_VERSIONS.has(requestedProtocol)) return rpcError(null, -32600, "Unsupported MCP-Protocol-Version", 400);
  const accept = request.headers.get("accept") ?? "";
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) return rpcError(null, -32600, "Accept must include application/json and text/event-stream", 406);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return rpcError(null, -32600, "Content-Type must be application/json", 415);
  const s = adminClient();
  let principal: Principal;
  try { principal = await authenticate(request, s); }
  catch (error) { return rpcError(null, error instanceof ToolError ? error.code : -32001, error instanceof Error ? error.message : "Unauthorized", 401); }
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch { return rpcError(null, -32700, "Parse error"); }
  if (Array.isArray(parsed)) {
    if (!parsed.length) return rpcError(null, -32600, "Invalid JSON-RPC batch");
    const responses: Record<string, unknown>[] = [];
    for (const message of parsed) {
      const response = await dispatchMessage(message, principal, s, true);
      if (response) responses.push(response);
    }
    if (!responses.length) return new Response(null, { status: 202, headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } });
    return Response.json(responses, { headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } });
  }
  const response = await dispatchMessage(parsed, principal, s);
  if (!response) return new Response(null, { status: 202, headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } });
  return Response.json(response, { headers: { "MCP-Protocol-Version": MCP_PROTOCOL_VERSION } });
}

if (import.meta.main) Deno.serve(handleRequest);
