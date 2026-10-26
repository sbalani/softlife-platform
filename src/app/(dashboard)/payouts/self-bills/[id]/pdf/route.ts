import { createHash } from "node:crypto";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSessionProfile(), params]);
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.role === "operator") return new Response("Forbidden", { status: 403 });
  if (!UUID.test(id)) return new Response("Invalid self-bill", { status: 400 });
  const service = await createServiceClient();
  let query = service.from("payout_self_bills").select("id,tenant_id,status,odoo_name,pdf_storage_path,pdf_sha256,pdf_size_bytes").eq("id", id);
  if (session.role === "franchisee") {
    if (!session.tenant_id) return new Response("Forbidden", { status: 403 });
    query = query.eq("tenant_id", session.tenant_id);
  }
  const { data: bill, error } = await query.maybeSingle();
  if (error) return new Response("Could not load self-bill", { status: 500 });
  if (!bill || bill.status !== "completed" || !bill.pdf_storage_path || !bill.pdf_sha256 || !bill.pdf_size_bytes) return new Response("Self-bill PDF not found", { status: 404 });
  const { data: stored, error: downloadError } = await service.storage.from("payout-self-bills").download(bill.pdf_storage_path);
  if (downloadError || !stored) return new Response("Self-bill PDF not found", { status: 404 });
  const bytes = new Uint8Array(await stored.arrayBuffer());
  if (bytes.length !== bill.pdf_size_bytes || createHash("sha256").update(bytes).digest("hex") !== bill.pdf_sha256) return new Response("Self-bill PDF integrity check failed", { status: 500 });
  const filename = String(bill.odoo_name || `self-bill-${id}`).replace(/[^A-Za-z0-9._-]+/g, "-");
  return new Response(Buffer.from(bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    "Cache-Control": "private, no-store",
  } });
}
