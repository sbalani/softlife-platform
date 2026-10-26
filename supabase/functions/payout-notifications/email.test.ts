import { assertEquals, assertStringIncludes } from "@std/assert";
import { formatPayoutEmail } from "./email.ts";

const email = formatPayoutEmail({
  recipientName: `Ana <script>alert("x")</script> & O'Neil`,
  amountCents: 123456,
  periodMonth: "2026-10-01",
  paymentReference: `TRF-<octubre>&"`,
  payoutsUrl: "https://platform.softlife.es/payouts",
});

Deno.test("formats Spanish payout content with amount, month, reference, and link", () => {
  assertStringIncludes(email.subject, "octubre de 2026");
  assertStringIncludes(email.text, "1234,56");
  assertStringIncludes(email.text, "TRF-<octubre>&\"");
  assertStringIncludes(email.text, "https://platform.softlife.es/payouts");
  assertEquals(email.attachments, []);
});

Deno.test("escapes every interpolated HTML value", () => {
  assertEquals(email.html.includes("<script>"), false);
  assertStringIncludes(email.html, "Ana &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; O&#39;Neil");
  assertStringIncludes(email.html, "TRF-&lt;octubre&gt;&amp;&quot;");
});
