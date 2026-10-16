import assert from "node:assert/strict";
import test from "node:test";
import { huaxinDeviceRows, huaxinOrderPage, isAllowedInsecureHuaxinUrl } from "./client.ts";

test("TLS verification can only be disabled for the exact Huaxin UAT host", () => {
  assert.equal(isAllowedInsecureHuaxinUrl("https://uatapi.huaxinvending.com/machine/cloud/api/devices"), true);
  assert.equal(isAllowedInsecureHuaxinUrl("http://uatapi.huaxinvending.com"), false);
  assert.equal(isAllowedInsecureHuaxinUrl("https://uatapi.huaxinvending.com.evil.example"), false);
  assert.equal(isAllowedInsecureHuaxinUrl("https://api.huaxinvending.com"), false);
});

test("malformed device and order envelopes are rejected", () => {
  assert.throws(() => huaxinDeviceRows({ success: true }), /invalid data/);
  assert.throws(() => huaxinOrderPage({ totalPage: 1 }), /invalid data/);
  assert.throws(() => huaxinOrderPage({ records: [null] }), /invalid data/);
});

test("valid empty Huaxin results remain valid", () => {
  assert.deepEqual(huaxinDeviceRows([]), []);
  assert.deepEqual(huaxinOrderPage({ records: [], totalPage: 2 }), {
    records: [],
    totalPage: 2,
  });
});
