export function refillInventoryQuantity(quantity: number, leftUnfinishedBottle: boolean): number {
  return Math.max(0, quantity - (leftUnfinishedBottle ? 1 : 0));
}

export function isValidBottleQuantity(quantity: number, finishedBottle: boolean, leftUnfinishedBottle: boolean): boolean {
  return (!finishedBottle && !leftUnfinishedBottle) || Number.isInteger(quantity);
}
