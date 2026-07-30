import assert from "node:assert/strict";
import test from "node:test";
import { huaxinLocalTimeToUtc, huaxinOrderTime } from "./order-time.ts";

test("prefers Huaxin UTC order time", () => {
  assert.equal(huaxinOrderTime({ createTime: "2026-07-29 20:27:54", createTimeUtc: "2026-07-29T12:27:54Z" }), "2026-07-29T12:27:54.000Z");
});

test("uses payment time when an offline sale is uploaded later", () => {
  assert.equal(huaxinOrderTime({
    localPayTime: "2026-07-22 02:54:15",
    createTime: "2026-07-30 19:40:17",
    createTimeUtc: "2026-07-30T11:40:17Z",
  }), "2026-07-21T18:54:15.000Z");
});

test("treats timezone-less Huaxin times as China Standard Time", () => {
  assert.equal(huaxinLocalTimeToUtc("2026-07-29 20:27:54"), "2026-07-29T12:27:54.000Z");
});

test("the known order displays at 14:27 in Madrid", () => {
  const instant = huaxinOrderTime({ createTimeUtc: "2026-07-29T12:27:54Z" });
  assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }).format(new Date(instant!)), "14:27");
});
