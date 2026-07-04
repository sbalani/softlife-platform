import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSupabaseConfigured()) {
    return Response.json({ error: { message: "Supabase not configured" } }, { status: 500 });
  }

  const body = await req.json();
  try {
    const s = await createServiceClient();
    // Map numeric device ID → Supabase uuid
    const { data: machine } = await s
      .from("machines")
      .select("id")
      .eq("device_id_huaxin", String(id))
      .maybeSingle();

    if (!machine) {
      return Response.json({ error: { message: "Machine not found" } }, { status: 404 });
    }

    const kind = body.kind ?? "full";
    const eventTime = body.device_event_time ?? new Date().toISOString();

    if (kind === "full") {
      await s.from("machines").update({ last_full_clean_date: eventTime }).eq("id", (machine as Record<string, unknown>).id);
    }

    return Response.json({ ok: true, server_receipt_time: new Date().toISOString() });
  } catch (e) {
    return Response.json({ error: { message: e instanceof Error ? e.message : String(e) } }, { status: 500 });
  }
}
