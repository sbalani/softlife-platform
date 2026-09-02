import assert from "node:assert/strict";
import test from "node:test";
import { safeInternalRedirect } from "./safe-redirect.ts";

const origin = "https://platform.softlife.es";

test("accepts same-origin callback destinations", () => {
  assert.equal(safeInternalRedirect("/dashboard?tab=users#row", origin, "/set-password"), "/dashboard?tab=users#row");
});

test("rejects absolute and backslash external callback destinations", () => {
  assert.equal(safeInternalRedirect("https://evil.example/", origin, "/set-password"), "/set-password");
  assert.equal(safeInternalRedirect("/\\evil.example", origin, "/set-password"), "/set-password");
  assert.equal(safeInternalRedirect("//evil.example", origin, "/set-password"), "/set-password");
});
