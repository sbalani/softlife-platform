import { normalizeLocale } from "@/lib/i18n/locale";
import { listPublicReportMachines } from "@/lib/public-reporting-server";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) return Response.json({ machines: [] }, { status: 503, headers: { "cache-control": "no-store" } });
  try {
    const locale = normalizeLocale(new URL(request.url).searchParams.get("locale"));
    return Response.json({ machines: await listPublicReportMachines(locale) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[public-incident-machines]", error);
    return Response.json({ machines: [] }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
