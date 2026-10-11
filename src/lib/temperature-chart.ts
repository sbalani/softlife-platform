export type TemperatureChartPoint = { label: string; value: number; minimum: number; maximum: number };

export function finiteTemperaturePoints(points: TemperatureChartPoint[]): TemperatureChartPoint[] {
  return points.filter((point) => [point.value, point.minimum, point.maximum].every(Number.isFinite)).map((point) => ({
    ...point,
    minimum: Math.min(point.minimum, point.maximum, point.value),
    maximum: Math.max(point.minimum, point.maximum, point.value),
  }));
}

export function temperatureTickIndexes(length: number, target: number): number[] {
  if (length <= 0) return [];
  if (length === 1) return [0];
  const count = Math.max(2, Math.min(Math.floor(target), length));
  return [...new Set(Array.from({ length: count }, (_, index) => Math.round(index * (length - 1) / (count - 1))))];
}
