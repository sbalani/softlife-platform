import { assertEquals, assertStringIncludes } from "@std/assert";
import { formatContractReminderEmail } from "./email.ts";

const email = formatContractReminderEmail({
  recipientName: `Ana <script>alert("x")</script> & O'Neil`,
  contractVersion: "SL-GESTOR-2026-10-26-v3",
  deadline: "14 de noviembre de 2026",
  accountUrl: "https://platform.softlife.es/account",
});

Deno.test("formats the current contract reminder in Spanish", () => {
  assertStringIncludes(email.subject, "SL-GESTOR-2026-10-26-v3");
  assertStringIncludes(email.html, "versión vigente");
  assertStringIncludes(email.text, "14 de noviembre de 2026");
  assertStringIncludes(email.text, "no bloqueará automáticamente tu acceso");
  assertStringIncludes(email.text, "pago podrá quedar pendiente de revisión manual");
  assertStringIncludes(email.text, "Si ya has aceptado esta versión, no tienes que hacer nada.");
});

Deno.test("includes the clear account acceptance link", () => {
  assertStringIncludes(email.html, 'href="https://platform.softlife.es/account"');
  assertStringIncludes(email.text, "https://platform.softlife.es/account");
});

Deno.test("escapes interpolated HTML content", () => {
  assertEquals(email.html.includes("<script>"), false);
  assertStringIncludes(email.html, "Ana &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; O&#39;Neil");
});
