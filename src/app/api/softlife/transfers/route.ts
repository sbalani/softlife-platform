import { getApiSession } from "@/lib/auth/api-session";
import { hasMobileCapability } from "@/lib/auth/mobile-authorization";
import { InventoryTransferValidationError, parseInventoryTransferInput } from "@/lib/inventory-transfer-contract";
import { getInventoryTransferWorkspace, recordInventoryTransfer } from "@/lib/inventory-transfers";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function context(req: Request) {
  if (!isSupabaseConfigured()) return { response: Response.json({ error: { message: "Not configured" } }, { status: 503 }) };
  const session = await getApiSession(req);
  if (!session) return { response: Response.json({ error: { message: "Unauthorized" } }, { status: 401 }) };
  if (!hasMobileCapability(session, "inventory.transfer")) return { response: Response.json({ error: { message: "Forbidden" } }, { status: 403 }) };
  return { session, service: await createServiceClient() };
}

export async function GET(req: Request) {
  const auth = await context(req);
  if ("response" in auth) return auth.response;
  try {
    const workspace = await getInventoryTransferWorkspace(auth.service);
    return Response.json({
      source_warehouse: workspace.sourceWarehouse,
      destination_warehouses: workspace.destinationWarehouses,
      lots: workspace.lots.map((lot) => ({ id: lot.id, name: lot.name, product_name: lot.productName, stock_unit: lot.stockUnit, quantity: lot.quantity, expiration_date: lot.expirationDate })),
      transfers: workspace.transfers.map((transfer) => ({ id: transfer.id, occurred_at: transfer.occurredAt, source_warehouse: transfer.sourceWarehouse, destination_warehouse: transfer.destinationWarehouse, lot_name: transfer.lotName, product_name: transfer.productName, quantity: transfer.quantity, reason: transfer.reason, sync_status: transfer.syncStatus, sync_error: transfer.syncError })),
    });
  } catch (error) {
    return Response.json({ error: { message: error instanceof Error ? error.message : String(error) } }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await context(req);
  if ("response" in auth) return auth.response;
  let input;
  try {
    const body: unknown = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InventoryTransferValidationError("Invalid transfer request.");
    input = parseInventoryTransferInput(body as Record<string, unknown>);
  } catch (error) {
    return Response.json({ error: { message: error instanceof InventoryTransferValidationError ? error.message : "Invalid transfer request." } }, { status: 400 });
  }
  try {
    const result = await recordInventoryTransfer(auth.service, auth.session.id, input);
    return Response.json({ client_uuid: input.clientUuid, status: result.status, movement_ids: result.movementIds, created: result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof InventoryTransferValidationError) return Response.json({ error: { message: error.message } }, { status: 400 });
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Transfer UUID conflicts") || message.includes("Transfer exceeds effective source stock")) return Response.json({ error: { message } }, { status: 409 });
    console.error("[inventory-transfer] Could not record transfer:", error);
    return Response.json({ error: { message: "Could not record transfer." } }, { status: 500 });
  }
}
