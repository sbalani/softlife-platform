import assert from "node:assert/strict";
import test from "node:test";
import { combinedTransferStatus, parseInventoryTransferInput } from "./inventory-transfer-contract.ts";

const valid = {
  client_uuid: "8ef54e5d-0745-4acf-9e91-51d66fd943d0",
  destination_warehouse_id: 4,
  odoo_lot_id: 22,
  quantity: 3.5,
  occurred_at: "2026-10-13T10:00:00.000Z",
  reason: " Restock Flowers Cafe ",
};

test("normalizes a valid inventory transfer", () => {
  assert.deepEqual(parseInventoryTransferInput(valid, Date.parse("2026-10-13T10:01:00.000Z")), {
    clientUuid: valid.client_uuid,
    destinationWarehouseId: 4,
    lotId: 22,
    quantity: 3.5,
    occurredAt: valid.occurred_at,
    reason: "Restock Flowers Cafe",
  });
});

test("rejects unsafe inventory transfer input", () => {
  assert.throws(() => parseInventoryTransferInput({ ...valid, quantity: 0 }), /positive quantity/);
  assert.throws(() => parseInventoryTransferInput({ ...valid, destination_warehouse_id: "x" }), /destination/);
  assert.throws(() => parseInventoryTransferInput({ ...valid, occurred_at: "2026-10-13T10:10:01.000Z" }, Date.parse("2026-10-13T10:00:00.000Z")), /transfer time/);
});

test("reports the most actionable status across both movement legs", () => {
  assert.equal(combinedTransferStatus(["reconciled", "retry_wait"]), "retry_wait");
  assert.equal(combinedTransferStatus(["reconciled", "cancelled"]), "cancelled");
  assert.equal(combinedTransferStatus(["reconciled", "reconciled"]), "reconciled");
  assert.equal(combinedTransferStatus([]), "unknown");
});
