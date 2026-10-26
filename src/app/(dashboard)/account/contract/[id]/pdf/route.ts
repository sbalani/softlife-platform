import { getSessionProfile } from "@/lib/auth/session";
import { canDownloadTenantAcceptance } from "@/lib/franchisee-contract-acceptance";
import { sha256Hex } from "@/lib/franchisee-onboarding-evidence";
import { createServiceClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSessionProfile(), params]);
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!UUID.test(id)) return new Response("Invalid acceptance", { status: 400 });
  const service = await createServiceClient();
  const { data, error } = await service.from("franchisee_contract_acceptances")
    .select("id,tenant_id,pdf_storage_path,pdf_sha256").eq("id", id).maybeSingle();
  if (error) return new Response("Could not load acceptance", { status: 500 });
  if (!data) return new Response("Acceptance not found", { status: 404 });
  if (!canDownloadTenantAcceptance(session, data)) return new Response("Forbidden", { status: 403 });
  const { data: stored, error: downloadError } = await service.storage.from("onboarding-contract-evidence").download(String(data.pdf_storage_path));
  if (downloadError || !stored) return new Response("Contract PDF not found", { status: 404 });
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (sha256Hex(bytes) !== data.pdf_sha256) return new Response("Contract PDF integrity check failed", { status: 500 });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="contrato-softlife-${id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
