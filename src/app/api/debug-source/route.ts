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
  let huaxinCause: string | null = null;
  if (cfg) {
    try {
      const devices = await listDevices(cfg);
      huaxinDeviceCount = devices.length;
    } catch (e) {
      const err = e as { name?: string; message?: string; cause?: { code?: string; message?: string } };
      huaxinError = err.name ? `${err.name}: ${err.message}` : String(e);
      if (err.cause) huaxinCause = `${err.cause.code ?? ""} ${err.cause.message ?? ""}`.trim();
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
      huaxinCause,
      wouldUse: supabaseConfigured ? "supabase" : cfg ? "huaxin" : "sample",
    },
    { status: 200 },
  );
}
