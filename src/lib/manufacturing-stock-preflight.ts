type ProductStock = { odoo_warehouse_id: number; odoo_product_id: number; available_quantity: number };
type ProductMeta = {
  odoo_id: number; name: string; uom: string | null; uom_rounding: number; tracking: string;
  package_content_quantity: number | null; package_content_uom: string | null;
};
type LotStock = {
  odoo_warehouse_id: number; odoo_lot_id: number; available_qty: number;
  lot_name: string; expiration_date: string | null; odoo_product_id: number;
};

const rounded = (value: number) => Number(value.toFixed(9));
const isUnit = (uom: string | null) => Boolean(uom && ["unit", "units", "u", "each"].includes(uom.trim().toLowerCase()));

export function buildManufacturingStockPreflight(input: {
  warehouses: Record<string, unknown>[];
  productStock: ProductStock[];
  products: ProductMeta[];
  lotStock: LotStock[];
  sourceWarehouseId: number;
  observedAt: string;
}) {
  const products = new Map(input.products.map((product) => [product.odoo_id, product]));
  const available = new Map(input.productStock.map((row) => [`${row.odoo_warehouse_id}:${row.odoo_product_id}`, Number(row.available_quantity)]));
  const required = new Map<string, { destination_warehouse_id: number; odoo_product_id: number; required_quantity: number; stock_uom: string }>();
  for (const warehouse of input.warehouses) {
    const warehouseId = Number(warehouse.odoo_warehouse_id);
    for (const recipe of (Array.isArray(warehouse.recipes) ? warehouse.recipes : []) as Record<string, unknown>[]) {
      for (const component of (Array.isArray(recipe.components) ? recipe.components : []) as Record<string, unknown>[]) {
        const productId = Number(component.odoo_product_id);
        const key = `${warehouseId}:${productId}`;
        const row = required.get(key) ?? {
          destination_warehouse_id: warehouseId, odoo_product_id: productId,
          required_quantity: 0, stock_uom: String(component.stock_uom ?? ""),
        };
        row.required_quantity += Number(component.stock_total_quantity ?? 0);
        required.set(key, row);
      }
    }
  }

  const requirements = [...required.values()].map((row) => {
    const product = products.get(row.odoo_product_id);
    const destinationAvailable = available.get(`${row.destination_warehouse_id}:${row.odoo_product_id}`) ?? 0;
    const shortage = Math.max(0, row.required_quantity - destinationAvailable);
    const increment = isUnit(product?.uom ?? null) ? 1 : Number(product?.uom_rounding ?? 0);
    const transferQuantity = shortage > 1e-9 && increment > 0
      ? rounded(Math.ceil((shortage - 1e-9) / increment) * increment) : 0;
    const candidates = input.lotStock.filter((lot) => lot.odoo_warehouse_id === input.sourceWarehouseId
      && lot.odoo_product_id === row.odoo_product_id && lot.available_qty >= increment)
      .map((lot) => ({
        odoo_lot_id: lot.odoo_lot_id, lot_name: lot.lot_name, expiration_date: lot.expiration_date,
        available_quantity: rounded(Math.floor((lot.available_qty + 1e-9) / increment) * increment),
      }));
    return {
      ...row,
      product_name: product?.name ?? `Odoo product ${row.odoo_product_id}`,
      required_quantity: rounded(row.required_quantity),
      available_quantity: rounded(destinationAvailable),
      shortage_quantity: rounded(shortage),
      transfer_quantity: transferQuantity,
      transfer_increment: increment,
      expected_residual_quantity: rounded(destinationAvailable + transferQuantity - row.required_quantity),
      package_content_quantity: product?.package_content_quantity ?? null,
      package_content_uom: product?.package_content_uom ?? null,
      tracking: product?.tracking ?? "none",
      lot_candidates: candidates,
    };
  });
  const shortages = requirements.filter((row) => row.transfer_quantity > 0);
  const sourceRequired = new Map<number, number>();
  for (const row of shortages.filter((item) => item.destination_warehouse_id !== input.sourceWarehouseId)) {
    sourceRequired.set(row.odoo_product_id, (sourceRequired.get(row.odoo_product_id) ?? 0) + row.transfer_quantity);
  }
  const uncovered = [...sourceRequired.entries()].flatMap(([productId, quantity]) => {
    const sourceAvailable = available.get(`${input.sourceWarehouseId}:${productId}`) ?? 0;
    const localRequirement = required.get(`${input.sourceWarehouseId}:${productId}`)?.required_quantity ?? 0;
    const product = products.get(productId);
    const sourceLots = input.lotStock.filter((lot) => lot.odoo_warehouse_id === input.sourceWarehouseId && lot.odoo_product_id === productId);
    const increment = isUnit(product?.uom ?? null) ? 1 : product?.uom_rounding ?? 0.01;
    const wholeLotCapacity = sourceLots.reduce((sum, lot) => sum + Math.floor((lot.available_qty + 1e-9) / increment) * increment, 0);
    const fractionalLotCapacity = sourceLots.reduce((sum, lot) => sum + lot.available_qty, 0) - wholeLotCapacity;
    const transferable = product?.tracking === "none"
      ? Math.max(0, sourceAvailable - localRequirement)
      : Math.max(0, wholeLotCapacity - Math.ceil(Math.max(0, localRequirement - fractionalLotCapacity) / increment) * increment);
    return transferable + 1e-9 < quantity ? [{
      odoo_product_id: productId, product_name: products.get(productId)?.name ?? `Odoo product ${productId}`,
      required_quantity: rounded(quantity), available_quantity: rounded(transferable),
    }] : [];
  });
  for (const row of shortages.filter((item) => item.destination_warehouse_id === input.sourceWarehouseId)) {
    uncovered.push({
      odoo_product_id: row.odoo_product_id, product_name: row.product_name,
      required_quantity: row.transfer_quantity, available_quantity: row.available_quantity,
    });
  }
  const automaticTransfers = shortages.filter((row) => row.tracking === "none" && row.destination_warehouse_id !== input.sourceWarehouseId).map((row) => ({
    transfer_key: `${input.sourceWarehouseId}:${row.destination_warehouse_id}:${row.odoo_product_id}`,
    source_warehouse_id: input.sourceWarehouseId,
    destination_warehouse_id: row.destination_warehouse_id,
    odoo_product_id: row.odoo_product_id,
    stock_uom: row.stock_uom,
    quantity: row.transfer_quantity,
    lots: [],
  }));
  return {
    required: shortages.length > 0,
    plan_complete: shortages.length > 0 && shortages.every((row) => row.tracking === "none"),
    source_warehouse_id: input.sourceWarehouseId,
    observed_at: input.observedAt,
    requirements,
    uncovered,
    transfers: automaticTransfers,
  };
}
