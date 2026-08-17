type OrderProductSource = {
  product_name?: string | null;
  products?: { goodsName?: string | null }[] | null;
};

export function orderProductNames(order: OrderProductSource): string[] {
  const names = (order.products ?? []).flatMap((product) => {
    const name = product.goodsName?.trim();
    return name ? [name] : [];
  });
  if (names.length) return names;
  const fallback = order.product_name?.trim();
  return fallback ? [fallback] : [];
}

export function orderProductLabel(order: OrderProductSource, resolve: (name: string) => string = (name) => name): string {
  return orderProductNames(order).map(resolve).join(" + ");
}
