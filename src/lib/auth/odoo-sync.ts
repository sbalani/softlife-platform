import { timingSafeEqual } from "node:crypto";

export function isOdooSyncAuthorized(request: Request) {
  const expected = process.env.ODOO_SYNC_SECRET;
  const supplied = request.headers.get("x-odoo-sync-secret");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}
