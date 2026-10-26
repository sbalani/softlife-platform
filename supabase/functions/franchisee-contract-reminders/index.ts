import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { formatContractReminderEmail } from "./email.ts";

const CONTRACT_DEADLINE = "14 de noviembre de 2026";
const DEFAULT_PLATFORM_URL = "https://platform.softlife.es";
const DEFAULT_FROM_EMAIL = "payments@softlife.es";

interface ClaimedReminder {
  reminder_id: string;
  contract_version: string;
  recipient_email: string;
  recipient_name: string;
  claim_token: string;
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function accountUrl() {
  const base = new URL(Deno.env.get("PLATFORM_URL") ?? DEFAULT_PLATFORM_URL);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error("PLATFORM_URL must use HTTP or HTTPS");
  }
  return new URL("/account", base).toString().replace(/\/$/, "");
}

async function authorized(supabase: SupabaseClient, token: string | null) {
  if (!token) return false;
  const { data, error } = await supabase.rpc("verify_franchisee_contract_reminder_token", { p_token: token });
  if (error) throw error;
  return data === true;
}

async function failReminder(supabase: SupabaseClient, reminder: ClaimedReminder, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const { error: failError } = await supabase.rpc("fail_franchisee_contract_reminder", {
    p_reminder_id: reminder.reminder_id,
    p_claim_token: reminder.claim_token,
    p_error: message,
  });
  if (failError) throw failError;
}

async function sendReminder(
  supabase: SupabaseClient,
  reminder: ClaimedReminder,
  resendApiKey: string,
  from: string,
  url: string,
) {
  const email = formatContractReminderEmail({
    recipientName: reminder.recipient_name,
    contractVersion: reminder.contract_version,
    deadline: CONTRACT_DEADLINE,
    accountUrl: url,
  });
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `franchisee-contract-reminder/${reminder.reminder_id}`,
    },
    body: JSON.stringify({
      from,
      to: [reminder.recipient_email],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok || !result?.id) {
    throw new Error(`Resend ${response.status}: ${result?.message ?? "respuesta no válida"}`);
  }

  const { error } = await supabase.rpc("complete_franchisee_contract_reminder", {
    p_reminder_id: reminder.reminder_id,
    p_claim_token: reminder.claim_token,
    p_provider_id: result.id,
  });
  if (error) throw error;
}

if (import.meta.main) {
  Deno.serve(async (request) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    try {
      const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if (!await authorized(supabase, request.headers.get("x-cron-token"))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }

      const resendApiKey = env("RESEND_API_KEY");
      const from = Deno.env.get("RESEND_FROM_EMAIL") ?? DEFAULT_FROM_EMAIL;
      const url = accountUrl();
      const { data, error } = await supabase.rpc("claim_franchisee_contract_reminders", { p_limit: 100 });
      if (error) throw error;
      const reminders = (data ?? []) as ClaimedReminder[];
      let sent = 0;
      let failed = 0;

      for (const reminder of reminders) {
        try {
          await sendReminder(supabase, reminder, resendApiKey, from, url);
          sent += 1;
        } catch (error) {
          console.error("Franchisee contract reminder failed", { reminderId: reminder.reminder_id, error });
          try {
            await failReminder(supabase, reminder, error);
          } catch (failError) {
            console.error("Could not record contract reminder failure", { reminderId: reminder.reminder_id, failError });
          }
          failed += 1;
        }
      }

      const { data: totals, error: totalsError } = await supabase.rpc("get_franchisee_contract_reminder_counts");
      if (totalsError) throw totalsError;
      return Response.json({ claimed: reminders.length, sent, failed, totals });
    } catch (error) {
      console.error("Franchisee contract reminder request failed", error);
      return Response.json({ error: "Contract reminder delivery unavailable" }, { status: 500 });
    }
  });
}
