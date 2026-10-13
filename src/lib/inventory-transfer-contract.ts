export type InventoryTransferInput = {
  clientUuid: string;
  destinationWarehouseId: number;
  lotId: number;
  quantity: number;
  occurredAt: string;
  reason: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InventoryTransferValidationError extends Error {}

export function parseInventoryTransferInput(value: Record<string, unknown>, now = Date.now()): InventoryTransferInput {
  const clientUuid = String(value.client_uuid ?? "");
  const destinationWarehouseId = Number(value.destination_warehouse_id);
  const lotId = Number(value.odoo_lot_id);
  const quantity = Number(value.quantity);
  const occurredAt = String(value.occurred_at ?? "");
  const reason = String(value.reason ?? "").trim().slice(0, 1000);
  const timestamp = Date.parse(occurredAt);
  if (!UUID.test(clientUuid)) throw new InventoryTransferValidationError("A valid transfer UUID is required.");
  if (!Number.isInteger(destinationWarehouseId) || destinationWarehouseId < 1) throw new InventoryTransferValidationError("Select a destination warehouse.");
  if (!Number.isInteger(lotId) || lotId < 1) throw new InventoryTransferValidationError("Select a source lot.");
  if (!Number.isFinite(quantity) || quantity <= 0) throw new InventoryTransferValidationError("Enter a positive quantity.");
  if (!Number.isFinite(timestamp) || timestamp > now + 5 * 60_000) throw new InventoryTransferValidationError("Enter a valid transfer time.");
  if (!reason) throw new InventoryTransferValidationError("Enter a transfer reason.");
  return { clientUuid, destinationWarehouseId, lotId, quantity, occurredAt: new Date(timestamp).toISOString(), reason };
}

export function combinedTransferStatus(statuses: string[]) {
  const priority = ["failed", "cancelled", "retry_wait", "processing", "pending", "accepted_awaiting_mirror", "reconciled"];
  return priority.find((status) => statuses.includes(status)) ?? "unknown";
}
