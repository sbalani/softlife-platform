export type MenuStockSourceItem = {
  position?: string | number;
  goodsName?: string;
  stock?: string | number;
  enable?: number;
};

export type MenuStockSnapshotItem = {
  menu_kind: "diy" | "unify";
  position: string;
  goods_name_raw: string | null;
  stock_raw: string;
  stock_count: number | null;
  enabled: boolean | null;
  platform_product_id: string | null;
  mapping_method: "explicit_hopper_assignment" | "unresolved";
  raw_item: MenuStockSourceItem;
};

export function menuStockCount(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function menuStockSnapshotItems(
  menu: { diy: MenuStockSourceItem[]; unify: MenuStockSourceItem[] },
  productByLane: ReadonlyMap<string, string>,
): MenuStockSnapshotItem[] {
  return [...menu.diy.map((item) => ({ kind: "diy" as const, item })), ...menu.unify.map((item) => ({ kind: "unify" as const, item }))]
    .flatMap(({ kind, item }) => {
      const position = String(item.position ?? "").trim();
      if (!position) return [];
      const productId = kind === "diy" ? productByLane.get(position) ?? null : null;
      return [{
        menu_kind: kind,
        position,
        goods_name_raw: String(item.goodsName ?? "").trim() || null,
        stock_raw: String(item.stock ?? "").trim(),
        stock_count: menuStockCount(item.stock),
        enabled: typeof item.enable === "number" ? item.enable !== 0 : null,
        platform_product_id: productId,
        mapping_method: productId ? "explicit_hopper_assignment" as const : "unresolved" as const,
        raw_item: item,
      }];
    });
}
