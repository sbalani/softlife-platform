export type DailyWeather = {
  day: string;
  temperatureMean: number;
  temperatureMin: number;
  temperatureMax: number;
  precipitation: number;
  weatherCode: number | null;
  locations: number;
};

export type LocationWeather = Omit<DailyWeather, "locations">;
export type OpenMeteoDaily = { time?: unknown[]; temperature_2m_mean?: unknown[]; temperature_2m_max?: unknown[]; temperature_2m_min?: unknown[]; precipitation_sum?: unknown[]; weather_code?: unknown[] };
export type WeatherActiveRange = { from: string; to: string };

export function filterWeatherByActiveRanges<T extends { day: string; locationKey: string }>(rows: T[], ranges: Map<string, WeatherActiveRange[]>): T[] {
  return rows.filter((row) => ranges.get(row.locationKey)?.some((range) => range.from <= row.day && range.to >= row.day));
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseOpenMeteoDaily(daily: OpenMeteoDaily | undefined): LocationWeather[] {
  if (!daily || !Array.isArray(daily.time) || !Array.isArray(daily.temperature_2m_mean) || !Array.isArray(daily.temperature_2m_max) || !Array.isArray(daily.temperature_2m_min) || !Array.isArray(daily.precipitation_sum) || !Array.isArray(daily.weather_code)) return [];
  return daily.time.flatMap((day, index) => {
    const mean = numeric(daily.temperature_2m_mean![index]);
    const maximum = numeric(daily.temperature_2m_max![index]);
    const minimum = numeric(daily.temperature_2m_min![index]);
    const precipitation = numeric(daily.precipitation_sum![index]);
    const code = numeric(daily.weather_code![index]);
    if (typeof day !== "string" || mean === null || maximum === null || minimum === null || precipitation === null) return [];
    return [{ day, temperatureMean: mean, temperatureMin: Math.min(minimum, maximum), temperatureMax: Math.max(minimum, maximum), precipitation, weatherCode: code !== null && Number.isInteger(code) ? code : null }];
  });
}

export function weatherCodeLabel(code: number | null): string {
  if (code === null) return "Unknown";
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

export function aggregateDailyWeather(rows: LocationWeather[]): DailyWeather[] {
  const byDay = new Map<string, LocationWeather[]>();
  for (const row of rows) byDay.set(row.day, [...(byDay.get(row.day) ?? []), row]);
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, values]) => {
    const average = (field: "temperatureMean" | "temperatureMin" | "temperatureMax" | "precipitation") => values.reduce((sum, row) => sum + row[field], 0) / values.length;
    const codes = new Map<number, number>();
    for (const row of values) if (row.weatherCode !== null) codes.set(row.weatherCode, (codes.get(row.weatherCode) ?? 0) + 1);
    const weatherCode = [...codes].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? null;
    return {
      day,
      temperatureMean: Number(average("temperatureMean").toFixed(1)),
      temperatureMin: Number(average("temperatureMin").toFixed(1)),
      temperatureMax: Number(average("temperatureMax").toFixed(1)),
      precipitation: Number(average("precipitation").toFixed(1)),
      weatherCode,
      locations: values.length,
    };
  });
}
