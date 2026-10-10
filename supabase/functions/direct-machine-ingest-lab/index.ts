import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const MAX_BODY_BYTES = 256 * 1024;
const SAFE_HEADERS = new Set([
  "content-encoding",
  "content-type",
  "user-agent",
  "x-device-id",
  "x-device-imei",
  "x-machine-id",
]);

class PayloadTooLarge extends Error {}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function secureEqual(actual: string | null, expected: string) {
  if (actual === null) return false;
  const left = new TextEncoder().encode(actual);
  const right = new TextEncoder().encode(expected);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

export function safeRequestMetadata(request: Request) {
  const headers: Record<string, string> = {};
  for (
    const [name, value] of [...request.headers.entries()].sort((
      [left],
      [right],
    ) => left.localeCompare(right))
  ) {
    if (SAFE_HEADERS.has(name)) headers[name] = value.slice(0, 1000);
  }
  const query: Record<string, string[]> = {};
  for (const [name, value] of new URL(request.url).searchParams) {
    if (name.toLowerCase() === "token") continue;
    query[name] = [...(query[name] ?? []), value.slice(0, 1000)];
  }
  return { headers, query };
}

export async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new PayloadTooLarge();
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new PayloadTooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function stringHint(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const hint = String(value).trim();
  return hint ? hint.slice(0, 200) : null;
}

export function deviceHint(request: Request, body: unknown) {
  const headerHint = stringHint(
    request.headers.get("x-device-id") ?? request.headers.get("x-machine-id") ??
      request.headers.get("x-device-imei"),
  );
  if (headerHint) return headerHint;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const nested = record.data && typeof record.data === "object" &&
      !Array.isArray(record.data)
    ? record.data as Record<string, unknown>
    : {};
  for (
    const key of [
      "device_imei",
      "deviceImei",
      "imei",
      "device_id",
      "deviceId",
      "machine_id",
      "machineId",
      "sn",
    ]
  ) {
    const hint = stringHint(record[key] ?? nested[key]);
    if (hint) return hint;
  }
  return null;
}

async function sha256Hex(value: Uint8Array) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(value).buffer,
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function handleDirectMachineIngest(
  request: Request,
  s: SupabaseClient,
  expectedToken: string,
) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, {
      status: 405,
      headers: { allow: "POST" },
    });
  }
  const url = new URL(request.url);
  const suppliedToken = request.headers.get("x-ingest-token") ??
    url.searchParams.get("token");
  if (!secureEqual(suppliedToken, expectedToken)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const bytes = await readBoundedBody(request);
    const bodyText = new TextDecoder().decode(bytes);
    let bodyJson: unknown = null;
    if (bodyText.trim()) {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch { /* Preserve non-JSON bodies as text. */ }
    }
    const metadata = safeRequestMetadata(request);
    const { data, error } = await s.from("direct_machine_payloads").insert({
      method: request.method,
      content_type: request.headers.get("content-type")?.slice(0, 200) ?? null,
      body_size_bytes: bytes.byteLength,
      body_sha256: await sha256Hex(bytes),
      body_json: bodyJson,
      body_text: bodyText,
      device_hint: deviceHint(request, bodyJson),
      query_params: metadata.query,
      request_headers: metadata.headers,
    }).select("id,received_at").single();
    if (error || !data) {
      throw error ?? new Error("Payload receipt was not stored");
    }
    return Response.json({
      ok: true,
      receipt_id: data.id,
      received_at: data.received_at,
    });
  } catch (error) {
    if (error instanceof PayloadTooLarge) {
      return Response.json({ error: "Payload exceeds 256 KiB" }, {
        status: 413,
      });
    }
    console.error(
      "Direct machine payload capture failed",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ error: "Capture unavailable" }, { status: 500 });
  }
}

if (import.meta.main) {
  const s = createClient(
    env("SUPABASE_URL"),
    env("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const token = env("DIRECT_MACHINE_INGEST_TOKEN");
  Deno.serve((request) => handleDirectMachineIngest(request, s, token));
}
