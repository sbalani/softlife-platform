import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { actionReportImageInput, apiKeyFromRequest, availableTools, completeWeatherSeries, dispatchMessage, isLowStock, isMcpNetSale, isOverheated, madridMidnightUtc, normalizedMcpOrderState, parseOpenMeteoDaily, reportPayload, salesNoteInput, structuredToolContent, summarizeTemperatureExcursions, temperatureExcursionInput, type Principal } from "./index.ts";

function principal(role: "admin" | "operator" | "franchisee", scopes: ("read" | "forms" | "commands" | "sales_context" | "sales_notes" | "incidents")[]): Principal {
  return {
    keyId: crypto.randomUUID(),
    profileId: crypto.randomUUID(),
    role,
    tenantId: role === "admin" ? null : crypto.randomUUID(),
    name: "Test user",
    scopes: new Set(scopes),
  };
}

Deno.test("tool listing enforces key scopes and role command fencing", () => {
  const operatorTools = availableTools(principal("operator", ["read", "forms", "commands"])).map((tool) => tool.name);
  assert(operatorTools.includes("list_machines"));
  assert(operatorTools.includes("get_inventory"));
  assert(operatorTools.includes("create_action_report_draft"));
  assert(operatorTools.includes("create_action_report_image_upload"));
  assert(operatorTools.includes("complete_action_report_image_upload"));
  assert(operatorTools.includes("cancel_action_report_image_upload"));
  assert(!operatorTools.includes("disable_machine_sales"));
  assert(!operatorTools.includes("dispense_free_cup"));

  const franchiseeTools = availableTools(principal("franchisee", ["commands"])).map((tool) => tool.name);
  assertEquals(franchiseeTools.sort(), ["disable_machine_sales", "dispense_free_cup"]);
});

Deno.test("sales context scopes expose only bounded context and note tools", () => {
  assertEquals(availableTools(principal("franchisee", ["sales_context"])).map((tool) => tool.name), ["list_sales_context_machines", "get_sales_context"]);
  assertEquals(availableTools(principal("franchisee", ["sales_notes"])).map((tool) => tool.name), ["create_sales_note", "delete_sales_note"]);
  assertEquals(availableTools(principal("operator", ["sales_context", "sales_notes"])), []);
});

Deno.test("temperature excursions are visible only to read-scoped admins", () => {
  const tool = availableTools(principal("admin", ["read"])).find((item) => item.name === "get_temperature_excursions");
  assert(tool);
  assert(tool.description.includes("list_machines"));
  assert(tool.description.includes("never guess"));
  assertEquals((tool.inputSchema as { additionalProperties?: boolean }).additionalProperties, false);
  assert(!availableTools(principal("admin", ["forms"])).some((item) => item.name === "get_temperature_excursions"));
  assert(!availableTools(principal("operator", ["read"])).some((item) => item.name === "get_temperature_excursions"));
  assert(!availableTools(principal("franchisee", ["read"])).some((item) => item.name === "get_temperature_excursions"));
});

Deno.test("incident tools separate read access from confirmed lifecycle mutations", async () => {
  const readTools = availableTools(principal("operator", ["read"])).map((tool) => tool.name);
  assert(!readTools.includes("list_incidents"));
  assert(!readTools.includes("get_incident"));
  assert(!readTools.includes("resolve_incident"));
  const formTools = availableTools(principal("operator", ["forms"])).map((tool) => tool.name);
  assert(!formTools.includes("start_incident"));
  assert(!formTools.includes("resolve_incident"));
  assert(!formTools.includes("reopen_incident"));
  assert(!formTools.includes("list_incidents"));
  const incidentTools = availableTools(principal("operator", ["incidents"])).map((tool) => tool.name);
  assertEquals(incidentTools, ["list_incidents", "get_incident", "start_incident", "resolve_incident", "reopen_incident"]);

  const incidentId = crypto.randomUUID();
  const actor = principal("admin", ["incidents"]);
  for (const [name, arguments_] of [
    ["start_incident", { incident_id: incidentId, confirm: false }],
    ["resolve_incident", { incident_id: incidentId, resolution_summary: "Fixed", confirm: false }],
    ["reopen_incident", { incident_id: incidentId, reason: "Recurrence", confirm: false }],
  ] as const) {
    const response = await dispatchMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: arguments_ } }, actor, null as never);
    assertEquals((response?.error as { message?: string }).message, "Explicit confirm=true is required");
  }

  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const database = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "mcp_read_incidents") return Promise.resolve({ data: [{ id: incidentId, status: "open", title: "Test incident" }], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
  const list = await dispatchMessage({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {
    name: "list_incidents", arguments: { source: "user", offset: 20, limit: 10 },
  } }, actor, database as never);
  assertEquals((list?.result as { structuredContent?: unknown }).structuredContent, { items: [{ id: incidentId, status: "open", title: "Test incident" }] });
  assertEquals(calls[0], { name: "mcp_read_incidents", args: {
    p_actor_id: actor.profileId, p_incident_id: null, p_status: "active", p_source: "user",
    p_machine_id: null, p_include_recovered: false, p_offset: 20, p_limit: 10,
  } });
  const started = await dispatchMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {
    name: "start_incident", arguments: { incident_id: incidentId, confirm: true },
  } }, actor, database as never);
  assertEquals((started?.result as { structuredContent?: unknown }).structuredContent, { incident_id: incidentId, status: "in_progress" });
  assertEquals(calls[1], { name: "start_incident", args: { p_incident_id: incidentId, p_actor_id: actor.profileId } });
  const fetched = await dispatchMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: {
    name: "get_incident", arguments: { incident_id: incidentId },
  } }, actor, database as never);
  assertEquals((fetched?.result as { structuredContent?: unknown }).structuredContent, { id: incidentId, status: "open", title: "Test incident" });
  assertEquals(calls[2], { name: "mcp_read_incidents", args: {
    p_actor_id: actor.profileId, p_incident_id: incidentId, p_status: "all", p_source: "all",
    p_machine_id: null, p_include_recovered: true, p_offset: 0, p_limit: 1,
  } });
  await dispatchMessage({ jsonrpc: "2.0", id: 5, method: "tools/call", params: {
    name: "resolve_incident", arguments: { incident_id: incidentId, resolution_summary: " Fixed safely ", confirm: true },
  } }, actor, database as never);
  assertEquals(calls[3], { name: "resolve_incident", args: {
    p_incident_id: incidentId, p_resolution_summary: "Fixed safely", p_actor_id: actor.profileId,
  } });
  await dispatchMessage({ jsonrpc: "2.0", id: 6, method: "tools/call", params: {
    name: "reopen_incident", arguments: { incident_id: incidentId, reason: " Recurrence ", confirm: true },
  } }, actor, database as never);
  assertEquals(calls[4], { name: "reopen_incident", args: {
    p_incident_id: incidentId, p_reason: "Recurrence", p_actor_id: actor.profileId,
  } });
});

Deno.test("temperature excursion input is strict and defaults to 30 Madrid-local days", () => {
  const machineId = crypto.randomUUID();
  assertEquals(temperatureExcursionInput({ machine_id: machineId, threshold_c: 8 }, "2026-09-10"), {
    machineId, thresholdC: 8, seriesName: undefined, range: { from: "2026-08-12", to: "2026-09-10" },
  });
  assertEquals(temperatureExcursionInput({ machine_id: machineId, threshold_c: -2, date_to: "2026-08-01", series_name: "Cabinet" }, "2026-09-10").range, { from: "2026-07-03", to: "2026-08-01" });
  assertThrows(() => temperatureExcursionInput({ machine_id: machineId, threshold_c: 8, unknown: true }, "2026-09-10"), Error, "Unknown tool argument");
  assertThrows(() => temperatureExcursionInput({ machine_id: "machine one", threshold_c: 8 }, "2026-09-10"), Error, "machine_id");
  assertThrows(() => temperatureExcursionInput({ machine_id: machineId, threshold_c: Infinity }, "2026-09-10"), Error, "finite");
  assertThrows(() => temperatureExcursionInput({ machine_id: machineId, threshold_c: 8, date_to: "2026-99-01" }, "2026-09-10"), Error, "YYYY-MM-DD");
  assertThrows(() => temperatureExcursionInput({ machine_id: machineId, threshold_c: 8, date_from: "2026-06-10", date_to: "2026-09-10" }, "2026-09-10"), Error, "92");
  assertThrows(() => temperatureExcursionInput({ machine_id: machineId, threshold_c: 8, date_to: "2026-09-11" }, "2026-09-10"), Error, "92");
  assertThrows(() => temperatureExcursionInput({ machine_id: machineId, threshold_c: 8, series_name: "x".repeat(201) }, "2026-09-10"), Error, "200");
});

Deno.test("temperature excursions use strict thresholds and Madrid-local days per exact series", () => {
  const series = summarizeTemperatureExcursions([
    { reading_time: "2026-03-28T22:50:00.000Z", series_name: "Cabinet", value: 10 },
    { reading_time: "2026-03-28T23:10:00.000Z", series_name: "Cabinet", value: 10.1 },
    { reading_time: "2026-03-28T23:40:00.000Z", series_name: "Cabinet", value: 12 },
    { reading_time: "2026-03-28T23:50:00.000Z", series_name: "Cabinet", value: 5 },
    { reading_time: "2026-03-29T00:40:00.000Z", series_name: "Cabinet", value: 11 },
    { reading_time: "2026-03-29T00:15:00.000Z", series_name: "Mix", value: 13 },
    { reading_time: "2026-03-29T22:30:00.000Z", series_name: "Cabinet", value: 15 },
  ], 10);
  assertEquals(series, [
    {
      series_name: "Cabinet", samples_total: 6, samples_above: 4, excursion_days: 2,
      days: [
        { day: "2026-03-29", maximum_c: 12, samples_total: 4, samples_above: 3, first_above_at: "2026-03-28T23:10:00.000Z", last_above_at: "2026-03-29T00:40:00.000Z", observed_span_minutes: 30, largest_gap_minutes: 50, above_threshold_run_count: 2, duration_is_estimate: true },
        { day: "2026-03-30", maximum_c: 15, samples_total: 1, samples_above: 1, first_above_at: "2026-03-29T22:30:00.000Z", last_above_at: "2026-03-29T22:30:00.000Z", observed_span_minutes: 0, largest_gap_minutes: 0, above_threshold_run_count: 1, duration_is_estimate: true },
      ],
    },
    {
      series_name: "Mix", samples_total: 1, samples_above: 1, excursion_days: 1,
      days: [{ day: "2026-03-29", maximum_c: 13, samples_total: 1, samples_above: 1, first_above_at: "2026-03-29T00:15:00.000Z", last_above_at: "2026-03-29T00:15:00.000Z", observed_span_minutes: 0, largest_gap_minutes: 0, above_threshold_run_count: 1, duration_is_estimate: true }],
    },
  ]);
  assertThrows(() => summarizeTemperatureExcursions(Array.from({ length: 21 }, (_, index) => ({
    reading_time: "2026-03-29T00:00:00.000Z", series_name: `Series ${index}`, value: 11,
  })), 10), Error, "more than 20 series");
});

Deno.test("temperature excursion tool returns the documented structured response", async () => {
  const machineId = crypto.randomUUID();
  const operations: string[] = [];
  const database = {
    from(table: string) {
      const query = {
        select() { return query; },
        eq(column: string, value: unknown) { operations.push(`${table}:eq:${column}:${value}`); return query; },
        gte(column: string, value: unknown) { operations.push(`${table}:gte:${column}:${value}`); return query; },
        lt(column: string, value: unknown) { operations.push(`${table}:lt:${column}:${value}`); return query; },
        not() { return query; },
        order(column: string) { operations.push(`${table}:order:${column}`); return query; },
        limit(value: number) { operations.push(`${table}:limit:${value}`); return query; },
        or(value: string) { operations.push(`${table}:or:${value}`); return query; },
        maybeSingle() { return Promise.resolve({ data: { id: machineId, name: "Machine", display_name: "Plaza", deployed: true }, error: null }); },
        then(resolve: (result: unknown) => void) {
          resolve({ data: [
            { id: crypto.randomUUID(), reading_time: "2026-09-01T10:00:00.000Z", series_name: "Cabinet", value: 9 },
            { id: crypto.randomUUID(), reading_time: "2026-09-01T10:30:00.000Z", series_name: "Cabinet", value: 11 },
          ], error: null });
        },
      };
      return query;
    },
  };
  const response = await dispatchMessage({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "get_temperature_excursions", arguments: { machine_id: machineId, threshold_c: 10, date_from: "2026-09-01", date_to: "2026-09-01", series_name: "Cabinet" } },
  }, principal("admin", ["read"]), database as never);
  const result = response?.result as { structuredContent: Record<string, unknown> };
  assertEquals(result.structuredContent, {
    machine: { id: machineId, name: "Plaza" },
    range: { from: "2026-09-01", to: "2026-09-01", timezone: "Europe/Madrid" },
    threshold_c: 10,
    operator: ">",
    samples_total: 2,
    series: [{
      series_name: "Cabinet", samples_total: 2, samples_above: 1, excursion_days: 1,
      days: [{ day: "2026-09-01", maximum_c: 11, samples_total: 2, samples_above: 1, first_above_at: "2026-09-01T10:30:00.000Z", last_above_at: "2026-09-01T10:30:00.000Z", observed_span_minutes: 0, largest_gap_minutes: 30, above_threshold_run_count: 1, duration_is_estimate: true }],
    }],
    warning: "Observed spans are estimates from sampled readings, not exact durations; gaps between readings may hide threshold crossings.",
  });
  assert(operations.includes("machines:eq:deployed:true"));
  assert(operations.includes("huaxin_temperatures:eq:series_name:Cabinet"));
  assert(operations.includes("huaxin_temperatures:order:reading_time"));
  assert(operations.includes("huaxin_temperatures:order:id"));
  assert(operations.includes("huaxin_temperatures:limit:1000"));
});

Deno.test("sales notes require valid dated evidence and HTTPS sources", () => {
  const args = { idempotency_key: crypto.randomUUID(), sales_date: "2026-09-01", category: "event", note: "Local festival", source_url: "https://example.com/event" };
  const input = salesNoteInput(args);
  assertEquals(input.note, "Local festival");
  assertThrows(() => salesNoteInput({ ...args, idempotency_key: crypto.randomUUID(), source_url: "http://example.com" }), Error, "HTTPS");
  assertThrows(() => salesNoteInput({ ...args, machine_id: [crypto.randomUUID()] }), Error, "machine_id");
  assertThrows(() => salesNoteInput({ ...args, source_url: ["https://example.com"] }), Error, "HTTPS");
  assertThrows(() => salesNoteInput({ ...args, unexpected: true }), Error, "Unknown tool argument");
});

Deno.test("Open-Meteo responses are reduced to known daily weather fields", () => {
  assertEquals(parseOpenMeteoDaily({ daily: { time: ["2026-09-01"], temperature_2m_mean: [21.4], temperature_2m_max: [28], temperature_2m_min: [16], precipitation_sum: [2.5], weather_code: [61] } }), [
    { day: "2026-09-01", temperature_mean: 21.4, temperature_min: 16, temperature_max: 28, precipitation_mm: 2.5, weather_code: 61 },
  ]);
  assertEquals(parseOpenMeteoDaily({ daily: { time: ["2026-09-01"], temperature_2m_mean: [null], temperature_2m_max: [28], temperature_2m_min: [16], precipitation_sum: [null], weather_code: [null] } }), []);
  assertEquals(parseOpenMeteoDaily({ arbitrary: "provider data" }), []);
  const rows = parseOpenMeteoDaily({ daily: { time: ["2026-09-01", "2026-09-01", "2026-09-03"], temperature_2m_mean: [20, 20, 20], temperature_2m_max: [25, 25, 25], temperature_2m_min: [15, 15, 15], precipitation_sum: [0, 0, 0], weather_code: [0, 0, 0] } });
  assertEquals(completeWeatherSeries(rows, "2026-09-01", "2026-09-03"), false);
});

Deno.test("Action Report image reservations reject unsupported or oversized payloads", () => {
  assertEquals(actionReportImageInput({ mime_type: "image/jpeg", size_bytes: 1024, line_number: 2 }), {
    mimeType: "image/jpeg", sizeBytes: 1024, lineNumber: 2, extension: "jpg",
  });
  assertThrows(() => actionReportImageInput({ mime_type: "image/gif", size_bytes: 1024 }), Error, "Unsupported");
  assertThrows(() => actionReportImageInput({ mime_type: "image/png", size_bytes: 4 * 1024 * 1024 + 1 }), Error, "Unsupported");
  assertThrows(() => actionReportImageInput({ mime_type: "image/png", size_bytes: 1024, line_number: 21 }), Error, "Invalid refill line");
});

Deno.test("MCP keys support bearer headers and the Codex URL fallback", () => {
  const urlKey = `sl_mcp_${"a".repeat(64)}`;
  const headerKey = `sl_mcp_${"b".repeat(64)}`;
  const endpoint = `https://example.com/softlife-mcp?key=${encodeURIComponent(urlKey)}`;
  assertEquals(apiKeyFromRequest(new Request(endpoint)), urlKey);
  assertEquals(apiKeyFromRequest(new Request(endpoint, { headers: { authorization: `Bearer ${headerKey}` } })), headerKey);
  assertEquals(apiKeyFromRequest(new Request(endpoint, { headers: { authorization: "OAuth value" } })), null);
});

Deno.test("structured tool content always uses the MCP object shape", () => {
  assertEquals(structuredToolContent([{ id: "one" }]), { items: [{ id: "one" }] });
  assertEquals(structuredToolContent({ count: 1 }), { count: 1 });
  assertEquals(structuredToolContent(null), { value: null });
});

Deno.test("MCP sales normalize stored Huaxin status and refund codes", () => {
  assertEquals(normalizedMcpOrderState({ order_state: "3", status_code: "3" }), "COMPLETE");
  assert(isMcpNetSale({ order_state: "3", status_code: "3", refund_status: "0", pay_type_raw: "刷卡" }));
  assert(!isMcpNetSale({ order_state: "3", status_code: "3", refund_status: "1", pay_type_raw: "刷卡" }));
  assert(!isMcpNetSale({ order_state: "COMPLETE", status_code: "3", refund_status: "0", pay_type_raw: "自动制作" }));
});

Deno.test("Huaxin safety states detect low stock and compressor overheat", () => {
  assert(!isLowStock([{ code: "status_0_lackmaterial", value: "正常" }]));
  assert(isLowStock([{ code: "status_0_lackmaterial", value: "lack" }]));
  assert(isOverheated([{ code: "status_0_overhot", value: "open" }]));
  assert(isOverheated([{ code: "status_0_code", value: "113-Compressor Overheat Protection" }]));
});

Deno.test("drafts may be incomplete but confirmation requires physical evidence", () => {
  const base = {
    client_uuid: crypto.randomUUID(),
    machine_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    action_modes: ["cleaning"],
    cleaning: {},
  };
  assertEquals(reportPayload(base, 0, "draft").mobilePayload.status, "draft");
  assertThrows(() => reportPayload(base, 1, "confirmed"), Error, "Cleaning material evidence is required");
  const confirmed = reportPayload({ ...base, cleaning: { material_used: true } }, 1, "confirmed");
  assertEquals(confirmed.mobilePayload.status, "confirmed");
  assertEquals(confirmed.waterBuckets, null);
});

Deno.test("Action Report refill bottle evidence is preserved", () => {
  const result = reportPayload({
    client_uuid: crypto.randomUUID(), machine_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
    action_modes: ["refill"], refill_lines: [{ quantity: 2, finished_bottle: true, left_unfinished_bottle: true }],
  }, 1, "confirmed");
  assertEquals(result.lines[0].finished_bottle, true);
  assertEquals(result.lines[0].left_unfinished_bottle, true);
});

Deno.test("other Action Reports require notes only when confirmed", () => {
  const base = {
    client_uuid: crypto.randomUUID(),
    machine_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    action_modes: ["other"],
  };
  reportPayload(base, 0, "draft");
  assertThrows(() => reportPayload(base, 1, "confirmed"), Error, "Notes are required");
});

Deno.test("Action Report tool schemas separate creation idempotency from update identity", () => {
  const tools = availableTools(principal("operator", ["forms"]));
  const create = tools.find((tool) => tool.name === "create_action_report_draft")?.inputSchema as { required: string[]; properties: Record<string, unknown>; anyOf: { required: string[] }[] };
  const update = tools.find((tool) => tool.name === "update_action_report_draft")?.inputSchema as { required: string[]; properties: Record<string, unknown> };
  assert(create.anyOf.some((option) => option.required.includes("idempotency_key")));
  assert(create.anyOf.some((option) => option.required.includes("client_uuid")));
  assert(Object.hasOwn(create.properties, "client_uuid"));
  assert(!create.required.includes("report_id"));
  assert(update.required.includes("report_id"));
  assert(update.required.includes("expected_revision"));
  assert(!Object.hasOwn(update.properties, "client_uuid"));
});

Deno.test("Action Reports reject duplicate and malformed incident identifiers", () => {
  const incidentId = crypto.randomUUID();
  const base = {
    client_uuid: crypto.randomUUID(), machine_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
    action_modes: ["other"], notes: "Checked machine",
  };
  assertThrows(() => reportPayload({ ...base, incident_ids: [incidentId, incidentId] }, 0, "draft"), Error, "Invalid incident_ids");
  assertThrows(() => reportPayload({ ...base, incident_ids: ["invalid"] }, 0, "draft"), Error, "Invalid incident_ids");
});

Deno.test("Madrid date boundaries use the correct seasonal UTC offset", () => {
  assertEquals(madridMidnightUtc("2026-01-15"), "2026-01-14T23:00:00.000Z");
  assertEquals(madridMidnightUtc("2026-08-15"), "2026-08-14T22:00:00.000Z");
});

Deno.test("notification-form tool calls are accepted without execution", async () => {
  const message = { jsonrpc: "2.0", method: "tools/call", params: { name: "dispense_free_cup", arguments: { confirm: true } } };
  assertEquals(await dispatchMessage(message, principal("admin", ["commands"]), null as never), null);
});

Deno.test("initialize is rejected inside a JSON-RPC batch", async () => {
  const response = await dispatchMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, principal("admin", ["read"]), null as never, true);
  assertEquals((response?.error as { code?: number }).code, -32600);
});

Deno.test("initialize validates parameters and negotiates supported versions", async () => {
  const actor = principal("admin", ["read"]);
  const invalid = await dispatchMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, actor, null as never);
  assertEquals((invalid?.error as { code?: number }).code, -32602);
  const valid = await dispatchMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, actor, null as never);
  assertEquals((valid?.result as { protocolVersion?: string }).protocolVersion, "2025-03-26");
  assertEquals((valid?.result as { serverInfo?: { version?: string } }).serverInfo?.version, "3.6.2");
  const unknown = await dispatchMessage({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, actor, null as never);
  assertEquals((unknown?.result as { protocolVersion?: string }).protocolVersion, "2025-03-26");
});
