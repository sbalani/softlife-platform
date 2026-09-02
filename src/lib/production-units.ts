export type StockConversion = {
  packageContentQuantity: number | null;
  packageContentUom: string | null;
  stockQuantity: number;
  stockUom: string;
};

type UnitDefinition = { category: "unit" | "weight" | "volume"; canonicalFactor: number; canonicalName: string };

function unitDefinition(raw: string): UnitDefinition | null {
  const value = raw.trim().toLowerCase();
  if (["unit", "units", "u", "each"].includes(value)) return { category: "unit", canonicalFactor: 1, canonicalName: "unit" };
  if (["g", "gram", "grams"].includes(value)) return { category: "weight", canonicalFactor: 1, canonicalName: "g" };
  if (["kg", "kilogram", "kilograms"].includes(value)) return { category: "weight", canonicalFactor: 1000, canonicalName: "kg" };
  if (["ml", "milliliter", "milliliters", "millilitre", "millilitres"].includes(value)) return { category: "volume", canonicalFactor: 1, canonicalName: "ml" };
  if (["l", "liter", "liters", "litre", "litres"].includes(value)) return { category: "volume", canonicalFactor: 1000, canonicalName: "l" };
  return null;
}

export function convertPortionToStock(input: {
  quantity: number;
  uom: string;
  stockUom: string;
  packageContentQuantity?: number | null;
  packageContentUom?: string | null;
}): StockConversion {
  const portion = unitDefinition(input.uom);
  const stock = unitDefinition(input.stockUom);
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || !portion) throw new Error("Invalid portion quantity or UoM.");
  if (!stock) throw new Error(`Unsupported Odoo stock UoM: ${input.stockUom || "missing"}.`);

  if (portion.category === stock.category) {
    return {
      packageContentQuantity: null,
      packageContentUom: null,
      stockQuantity: input.quantity * portion.canonicalFactor / stock.canonicalFactor,
      stockUom: stock.canonicalName,
    };
  }

  if (stock.category !== "unit") throw new Error(`Portion UoM ${input.uom} is incompatible with Odoo stock UoM ${input.stockUom}.`);
  const packageQuantity = Number(input.packageContentQuantity);
  const packageUnit = unitDefinition(input.packageContentUom ?? "");
  if (!Number.isFinite(packageQuantity) || packageQuantity <= 0 || !packageUnit) throw new Error("Unit-stocked ingredient is missing net content per unit.");
  if (packageUnit.category !== portion.category) throw new Error(`Portion UoM ${input.uom} is incompatible with package content UoM ${input.packageContentUom}.`);

  return {
    packageContentQuantity: packageQuantity,
    packageContentUom: packageUnit.canonicalName,
    stockQuantity: input.quantity * portion.canonicalFactor / (packageQuantity * packageUnit.canonicalFactor),
    stockUom: "unit",
  };
}
