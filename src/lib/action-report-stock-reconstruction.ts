export type StockReconstructionItem = {
  menuKind: string;
  position: string;
  goodsName: string | null;
  observedStock: number | null;
};

export type StockReconstructionOrder = {
  orderTime: string;
  orderState: string;
  refundStatus: string | null;
  payTypeRaw: string | null;
  nums: number;
  products: { position?: string | number }[];
  listRaw: { productName?: unknown; goodsName?: unknown } | null;
};

function normalizedName(value: unknown) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function isCompletedSale(order: StockReconstructionOrder) {
  const refund = String(order.refundStatus ?? "").toLowerCase();
  const payType = String(order.payTypeRaw ?? "").trim().toLowerCase();
  return ["3", "complete"].includes(order.orderState.toLowerCase())
    && !["1", "refunded"].includes(refund)
    && !["自动制作", "admin override"].includes(payType)
    && Number.isSafeInteger(order.nums) && order.nums > 0;
}

export function reconstructStockAtAction(
  items: StockReconstructionItem[],
  orders: StockReconstructionOrder[],
  occurredAt: string,
  capturedAt: string,
  hasCompleteOrderCoverage: boolean,
) {
  const relevantOrders = orders.filter((order) => order.orderTime > occurredAt && order.orderTime <= capturedAt && isCompletedSale(order));
  const unifyNameCounts = new Map<string, number>();
  for (const item of items.filter((item) => item.menuKind === "unify")) {
    const name = normalizedName(item.goodsName);
    if (name) unifyNameCounts.set(name, (unifyNameCounts.get(name) ?? 0) + 1);
  }
  const unifyNames = new Set(unifyNameCounts.keys());
  const hasUnmatchedUnifiedOrder = relevantOrders.some((order) => {
    const soldName = normalizedName(order.listRaw?.productName ?? order.listRaw?.goodsName);
    return !soldName || !unifyNames.has(soldName);
  });
  return items.map((item) => {
    let consumed = 0;
    let complete = item.observedStock !== null && hasCompleteOrderCoverage;
    let incompleteReason = item.observedStock === null ? "unreadable observed stock" : hasCompleteOrderCoverage ? null : "waiting for sales sync";
    for (const order of relevantOrders) {
      if (!Number.isSafeInteger(order.nums) || order.nums <= 0) {
        complete = false;
        continue;
      }
      if (item.menuKind === "diy") {
        if (!order.products.length || order.products.some((product) => !String(product.position ?? "").trim())) {
          complete = false;
          incompleteReason = "sales data is missing menu positions";
          continue;
        }
        const positions = new Set(order.products.map((product) => String(product.position ?? "").trim()).filter(Boolean));
        if (positions.has(item.position)) consumed += order.nums;
        continue;
      }
      const soldName = normalizedName(order.listRaw?.productName ?? order.listRaw?.goodsName);
      if (soldName === normalizedName(item.goodsName)) consumed += order.nums;
    }
    if (item.menuKind === "unify" && (hasUnmatchedUnifiedOrder || (unifyNameCounts.get(normalizedName(item.goodsName)) ?? 0) !== 1)) {
      complete = false;
      incompleteReason = "sold menu identity is ambiguous";
    }
    return {
      ...item,
      consumedSinceAction: consumed,
      stockAtAction: complete && item.observedStock !== null ? item.observedStock + consumed : null,
      calculationComplete: complete,
      incompleteReason: complete ? null : incompleteReason,
    };
  });
}
