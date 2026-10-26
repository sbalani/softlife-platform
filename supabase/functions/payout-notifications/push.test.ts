import { assertEquals, assertThrows } from "@std/assert";
import { buildPayoutPushPayload, chunkPushTokens } from "./push.ts";

Deno.test("chunks Expo tokens at the API maximum", () => {
  const tokens = Array.from({ length: 205 }, (_, index) => ({ id: String(index), token: `ExponentPushToken[${index}]` }));
  assertEquals(chunkPushTokens(tokens).map((chunk) => chunk.length), [100, 100, 5]);
  assertThrows(() => chunkPushTokens(tokens, 101));
});

Deno.test("builds a payout push that opens the inbox payout destination", () => {
  const payload = buildPayoutPushPayload({
    notificationId: "notification-id",
    title: "Pago recibido",
    body: "Se ha realizado el pago.",
    href: "/payouts",
    data: { settlementId: "settlement-id" },
  }, "ExponentPushToken[token]");
  assertEquals(payload.to, "ExponentPushToken[token]");
  assertEquals(payload.channelId, "payouts");
  assertEquals(payload.data as Record<string, unknown>, { settlementId: "settlement-id", notificationId: "notification-id", href: "/payouts" });
});
