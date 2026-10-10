import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deviceHint,
  handleDirectMachineIngest,
  MAX_BODY_BYTES,
  readBoundedBody,
  safeRequestMetadata,
} from "./index.ts";

Deno.test("capture metadata redacts credentials and preserves repeated query values", () => {
  const request = new Request(
    "https://example.test/ingest?token=secret&event=one&event=two",
    {
      headers: {
        authorization: "Bearer secret",
        "x-ingest-token": "secret",
        "x-device-id": "machine-1",
        "x-custom": "value",
      },
    },
  );
  assertEquals(safeRequestMetadata(request), {
    headers: { "x-device-id": "machine-1" },
    query: { event: ["one", "two"] },
  });
});

Deno.test("device hints support headers and common flat or nested payload keys", () => {
  assertEquals(
    deviceHint(
      new Request("https://example.test", {
        headers: { "x-device-imei": "header-imei" },
      }),
      { imei: "body-imei" },
    ),
    "header-imei",
  );
  assertEquals(
    deviceHint(new Request("https://example.test"), {
      data: { deviceImei: 12345 },
    }),
    "12345",
  );
  assertEquals(
    deviceHint(new Request("https://example.test"), { unknown: true }),
    null,
  );
});

Deno.test("bounded body reader accepts the limit and rejects larger declared bodies", async () => {
  assertEquals(
    (await readBoundedBody(
      new Request("https://example.test", {
        method: "POST",
        body: new Uint8Array(MAX_BODY_BYTES),
      }),
    )).byteLength,
    MAX_BODY_BYTES,
  );
  const response = await handleDirectMachineIngest(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        "x-ingest-token": "test",
        "content-length": String(MAX_BODY_BYTES + 1),
      },
      body: "x",
    }),
    {} as never,
    "test",
  );
  assertEquals(response.status, 413);
});

Deno.test("receiver authenticates, parses JSON, and stores one redacted receipt", async () => {
  let inserted: Record<string, unknown> | null = null;
  const database = {
    from(table: string) {
      assertEquals(table, "direct_machine_payloads");
      return {
        insert(value: Record<string, unknown>) {
          inserted = value;
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: {
                      id: "receipt",
                      received_at: "2026-10-09T10:00:00Z",
                    },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };
  const unauthorized = await handleDirectMachineIngest(
    new Request("https://example.test", { method: "POST", body: "{}" }),
    database as never,
    "test",
  );
  assertEquals(unauthorized.status, 401);
  const response = await handleDirectMachineIngest(
    new Request("https://example.test?token=test&kind=status", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "do-not-store",
        "x-forwarded-for": "192.0.2.1",
      },
      body: JSON.stringify({ imei: "test-imei", temperature: 7.2 }),
    }),
    database as never,
    "test",
  );
  assertEquals(response.status, 200);
  assertEquals(inserted === null, false);
  const captured = inserted as unknown as Record<string, unknown>;
  assertEquals(captured.device_hint, "test-imei");
  assertEquals(captured.body_json, { imei: "test-imei", temperature: 7.2 });
  assertEquals(captured.query_params, { kind: ["status"] });
  assertEquals(
    (captured.request_headers as Record<string, string>).authorization,
    undefined,
  );
  assertEquals(
    (captured.request_headers as Record<string, string>)["x-forwarded-for"],
    undefined,
  );
  assertMatch(String(captured.body_sha256), /^[0-9a-f]{64}$/);
});
