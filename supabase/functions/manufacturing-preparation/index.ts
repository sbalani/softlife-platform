import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  manufacturingClaimBody,
  prepareManufacturingPeriod,
} from "../../../src/lib/data/odoo-production.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function authorizeManufacturingWorker(s: SupabaseClient, token: string | null) {
  if (!token) return false;
  const { data, error } = await s.rpc("verify_manufacturing_preparation_token", { p_token: token });
  if (error) throw error;
  return data === true;
}

export async function processNextManufacturingPreparation(s: SupabaseClient) {
  const { data: claim, error } = await s.rpc("claim_manufacturing_preparation");
  if (error) throw error;
  if (!claim) return false;
  const row = claim as Record<string, unknown>;
  try {
    await prepareManufacturingPeriod(s, manufacturingClaimBody(row), String(row.initiated_by) as "odoo" | "platform", {
      exportId: String(row.id),
      claimToken: String(row.preparation_claim_token),
    });
  } catch (cause) {
    console.error("Manufacturing preparation failed", { exportId: row.id, cause });
  }
  return true;
}

if (import.meta.main) {
  Deno.serve(async (request) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    try {
      const s = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if (!await authorizeManufacturingWorker(s, request.headers.get("x-cron-token"))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      EdgeRuntime.waitUntil(processNextManufacturingPreparation(s));
      return Response.json({ accepted: true }, { status: 202 });
    } catch (error) {
      console.error("Manufacturing worker request failed", error);
      return Response.json({ error: "Worker unavailable" }, { status: 500 });
    }
  });
}
