import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canonicalStatuses, statusHash } from "./status.ts";

Deno.test("canonical status comparisons ignore response order and duplicate old values", async () => {
  const first = [
    { code: "b", desc: "B", value: "2" },
    { code: "a", desc: "A", value: "old" },
    { code: "a", desc: "A", value: "1" },
  ];
  const second = [
    { code: "a", desc: "A", value: "1" },
    { code: "b", desc: "B", value: "2" },
  ];
  assertEquals(canonicalStatuses(first), canonicalStatuses(second));
  assertEquals(await statusHash(first), await statusHash(second));
});

Deno.test("status hash changes when a current value changes", async () => {
  const before = await statusHash([{ code: "status", value: "online" }]);
  const after = await statusHash([{ code: "status", value: "offline" }]);
  assertEquals(before === after, false);
});

Deno.test("status hash ignores nested JSON object key order", async () => {
  const first = await statusHash([{ code: "status", data: { z: 1, nested: { b: 2, a: 1 } } }]);
  const second = await statusHash([{ code: "status", data: { nested: { a: 1, b: 2 }, z: 1 } }]);
  assertEquals(first, second);
});
