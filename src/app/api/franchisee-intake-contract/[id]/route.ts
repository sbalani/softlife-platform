import { getSessionProfile } from "@/lib/auth/session";
import { tokenMatches, sha256Hex } from "@/lib/franchisee-onboarding-evidence";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !isSupabaseConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return new Response("Not found", { status: 404, headers: RESPONSE_HEADERS });
  }
  const s = await createServiceClient();
  const { data, error } = await s.from("franchisee_intake_submissions")
    .select("pdf_storage_path,pdf_sha256,download_token_sha256")
    .eq("id", id).not("accepted_at", "is", null).maybeSingle();
  if (error || !data) return new Response("Not found", { status: 404, headers: RESPONSE_HEADERS });

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const publicAuthorized = Boolean(token && tokenMatches(token, String(data.download_token_sha256)));
  if (!publicAuthorized) {
    const profile = await getSessionProfile();
    if (profile?.role !== "admin") return new Response("Not found", { status: 404, headers: RESPONSE_HEADERS });
  }

  const { data: stored, error: downloadError } = await s.storage.from("onboarding-contract-evidence").download(String(data.pdf_storage_path));
  if (downloadError || !stored) return new Response("Not found", { status: 404, headers: RESPONSE_HEADERS });
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (sha256Hex(bytes) !== data.pdf_sha256) return new Response("Evidence integrity check failed", { status: 409, headers: RESPONSE_HEADERS });

  return new Response(bytes, {
    headers: {
      ...RESPONSE_HEADERS,
      "Content-Disposition": `attachment; filename="softlife-contract-${id}.pdf"`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "application/pdf",
    },
  });
}
