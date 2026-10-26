import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { formatPayoutEmail } from "./email.ts";
import { buildPayoutPushPayload, chunkPushTokens, type PushTokenSnapshot } from "./push.ts";

const DEFAULT_FROM_EMAIL = "payments@softlife.es";
const PAYOUTS_URL = "https://platform.softlife.es/payouts";

interface ClaimedEmail {
  outbox_id: string;
  settlement_id: string;
  recipient_email: string;
  recipient_name: string;
  amount_cents: number;
  period_month: string;
  payment_reference: string;
  claim_token: string;
}

interface ClaimedPush {
  notification_id: string;
  title: string;
  body: string;
  href: string;
  data: Record<string, unknown>;
  push_tokens: PushTokenSnapshot[];
  claim_token: string;
}

interface ExpoTicket {
  id?: string;
  status?: string;
  message?: string;
  details?: { error?: string };
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function rpc(supabase: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

async function sendEmail(supabase: SupabaseClient, email: ClaimedEmail, resendApiKey: string, from: string) {
  const content = formatPayoutEmail({
    recipientName: email.recipient_name,
    amountCents: email.amount_cents,
    periodMonth: email.period_month,
    paymentReference: email.payment_reference,
    payoutsUrl: PAYOUTS_URL,
  });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `payout-paid/${email.settlement_id}`,
    },
    body: JSON.stringify({
      from,
      to: [email.recipient_email],
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(content.attachments.length ? { attachments: content.attachments } : {}),
    }),
  });
  const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok || !result?.id) throw new Error(`Resend ${response.status}: ${result?.message ?? "respuesta no válida"}`);
  await rpc(supabase, "complete_payout_email", {
    p_outbox_id: email.outbox_id,
    p_claim_token: email.claim_token,
    p_provider_id: result.id,
  });
}

async function sendPush(supabase: SupabaseClient, push: ClaimedPush) {
  const providerIds: string[] = [];
  let accepted = 0;
  let deviceNotRegistered = 0;
  const tokens = Array.isArray(push.push_tokens) ? push.push_tokens : [];
  if (!tokens.length) {
    await rpc(supabase, "complete_payout_notification_push", {
      p_notification_id: push.notification_id,
      p_claim_token: push.claim_token,
      p_provider_ids: [],
      p_no_device: true,
    });
    return;
  }

  for (const chunk of chunkPushTokens(tokens)) {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(Deno.env.get("EXPO_ACCESS_TOKEN") ? { Authorization: `Bearer ${Deno.env.get("EXPO_ACCESS_TOKEN")}` } : {}),
      },
      body: JSON.stringify(chunk.map((token) => buildPayoutPushPayload({
        notificationId: push.notification_id,
        title: push.title,
        body: push.body,
        href: push.href,
        data: push.data,
      }, token.token))),
    });
    if (!response.ok) throw new Error(`Expo ${response.status}: ${await response.text()}`);
    const tickets = (await response.json() as { data?: ExpoTicket[] }).data ?? [];
    for (let index = 0; index < chunk.length; index++) {
      const ticket = tickets[index];
      if (ticket?.status === "ok") {
        accepted += 1;
        if (ticket.id) providerIds.push(ticket.id);
      } else if (ticket?.details?.error === "DeviceNotRegistered") {
        deviceNotRegistered += 1;
        const { error } = await supabase.from("mobile_push_tokens").delete().eq("id", chunk[index].id);
        if (error) throw error;
      } else {
        throw new Error(`Expo rechazó la notificación: ${ticket?.message ?? "respuesta no válida"}`);
      }
    }
  }

  if (!accepted && deviceNotRegistered === tokens.length) {
    await rpc(supabase, "complete_payout_notification_push", {
      p_notification_id: push.notification_id,
      p_claim_token: push.claim_token,
      p_provider_ids: providerIds,
      p_no_device: true,
    });
    return;
  }
  if (!accepted) throw new Error("Ningún dispositivo aceptó la notificación");
  await rpc(supabase, "complete_payout_notification_push", {
    p_notification_id: push.notification_id,
    p_claim_token: push.claim_token,
    p_provider_ids: providerIds,
    p_no_device: false,
  });
}

if (import.meta.main) {
  Deno.serve(async (request) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const valid = await rpc(supabase, "verify_payout_notifications_token", { p_token: request.headers.get("x-cron-token") });
      if (valid !== true) return Response.json({ error: "Unauthorized" }, { status: 401 });

      const resendApiKey = env("RESEND_API_KEY");
      const [emails, pushes] = await Promise.all([
        rpc(supabase, "claim_payout_emails", { p_limit: 50 }) as Promise<ClaimedEmail[]>,
        rpc(supabase, "claim_payout_notification_pushes", { p_limit: 50 }) as Promise<ClaimedPush[]>,
      ]);
      const counts = { emailsClaimed: emails.length, emailsSent: 0, emailsFailed: 0, pushesClaimed: pushes.length, pushesSent: 0, pushesFailed: 0 };
      const from = Deno.env.get("RESEND_FROM_EMAIL") ?? DEFAULT_FROM_EMAIL;

      for (const email of emails) {
        try {
          await sendEmail(supabase, email, resendApiKey, from);
          counts.emailsSent += 1;
        } catch (error) {
          console.error("Payout email failed", { outboxId: email.outbox_id, error });
          await rpc(supabase, "fail_payout_email", {
            p_outbox_id: email.outbox_id,
            p_claim_token: email.claim_token,
            p_error: error instanceof Error ? error.message : String(error),
          }).catch((failError) => console.error("Could not record payout email failure", failError));
          counts.emailsFailed += 1;
        }
      }
      for (const push of pushes) {
        try {
          await sendPush(supabase, push);
          counts.pushesSent += 1;
        } catch (error) {
          console.error("Payout push failed", { notificationId: push.notification_id, error });
          await rpc(supabase, "fail_payout_notification_push", {
            p_notification_id: push.notification_id,
            p_claim_token: push.claim_token,
            p_error: error instanceof Error ? error.message : String(error),
          }).catch((failError) => console.error("Could not record payout push failure", failError));
          counts.pushesFailed += 1;
        }
      }
      return Response.json(counts);
    } catch (error) {
      console.error("Payout notification request failed", error);
      return Response.json({ error: "Payout notification delivery unavailable" }, { status: 500 });
    }
  });
}
