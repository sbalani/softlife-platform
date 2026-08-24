import { languagePackEntries, type ProductDiyItem } from "../huaxin/client.ts";

export type MobileMachineMenuSource = { diy: ProductDiyItem[]; unify: ProductDiyItem[] };

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function menuItem(kind: "diy" | "unify", item: ProductDiyItem, platformProductId: string | null) {
  const position = String(item.position ?? "");
  return {
    id: `${kind}:${position}`,
    kind,
    position,
    name: {
      default: item.goodsName?.trim() || null,
      translations: Object.fromEntries(languagePackEntries(item).map((entry) => [entry.code, entry.goodsName])),
    },
    stock: numberOrNull(item.stock),
    enabled: item.enable == null ? null : Number(item.enable) !== 0,
    price: item.price == null ? null : String(item.price),
    market_price: item.marketPrice == null ? null : String(item.marketPrice),
    image_url: item.imagePath?.trim() || null,
    allergen_url: item.allergyPath?.trim() || null,
    platform_product_id: platformProductId,
  };
}

function sortByPosition<T extends { position: string }>(items: T[]) {
  return items.sort((a, b) => {
    const numeric = Number(a.position) - Number(b.position);
    return Number.isFinite(numeric) && numeric !== 0 ? numeric : a.position.localeCompare(b.position);
  });
}

export function presentMachineMenu(
  source: MobileMachineMenuSource | null,
  syncedAt: string | null,
  diyProductIds: Readonly<Record<string, string | null>>,
  now = Date.now(),
) {
  const syncedTime = syncedAt ? Date.parse(syncedAt) : Number.NaN;
  const validSyncedAt = Number.isFinite(syncedTime) ? new Date(syncedTime).toISOString() : null;
  const ageSeconds = validSyncedAt ? Math.max(0, Math.floor((now - syncedTime) / 1000)) : null;
  const status = !source || !validSyncedAt ? "missing" : ageSeconds! > 26 * 60 * 60 ? "stale" : "fresh";
  return {
    snapshot: { status, synced_at: validSyncedAt, age_seconds: ageSeconds },
    menu: {
      diy: sortByPosition((source?.diy ?? []).map((item) => menuItem("diy", item, diyProductIds[String(item.position ?? "")] ?? null))),
      unify: sortByPosition((source?.unify ?? []).map((item) => menuItem("unify", item, null))),
    },
  };
}
