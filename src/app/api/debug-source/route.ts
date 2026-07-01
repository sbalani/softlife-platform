import { getConfigFromEnv, listDevices } from "@/lib/huaxin/client";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Temporary diagnostics — no secrets are exposed, only booleans/counts/errors.
 *  Remove once live data is confirmed working. */
export async function GET() {
  const supabaseConfigured = isSupabaseConfigured();
  const cfg = getConfigFromEnv();

  let huaxinDeviceCount: number | null = null;
  let huaxinError: string | null = null;
  if (cfg) {
    try {
      const devices = await listDevices(cfg);
      huaxinDeviceCount = devices.length;
    } catch (e) {
      huaxinError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }

  return Response.json(
    {
      serverTime: new Date().toISOString(),
      supabaseConfigured,
      huaxinConfigured: !!cfg,
      huaxinHost: cfg ? cfg.baseUrl.replace(/^https?:\/\//, "").split("/")[0] : null,
      huaxinVerifySsl: cfg?.verifySsl ?? null,
      huaxinDeviceCount,
      huaxinError,
      wouldUse: supabaseConfigured ? "supabase" : cfg ? "huaxin" : "sample",
    },
    { status: 200 },
  );
}
