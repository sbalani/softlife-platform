import { assert, assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { actionReportImageInput, apiKeyFromRequest, availableTools, dispatchMessage, isLowStock, isOverheated, madridMidnightUtc, reportPayload, type Principal } from "./index.ts";

function principal(role: "admin" | "operator" | "franchisee", scopes: ("read" | "forms" | "commands")[]): Principal {
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
  const unknown = await dispatchMessage({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2099-01-01", capabilities: {}, clientInfo: { name: "test", version: "1" } } }, actor, null as never);
  assertEquals((unknown?.result as { protocolVersion?: string }).protocolVersion, "2025-03-26");
});
