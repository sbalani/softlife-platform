import { unstable_cache } from "next/cache";
import { aggregateDailyWeather, filterWeatherByActiveRanges, parseOpenMeteoDaily, type DailyWeather, type LocationWeather, type OpenMeteoDaily, type WeatherActiveRange } from "@/lib/weather";
import { shiftDay } from "@/lib/analytics";

type WeatherLocation = { latitude: number | null; longitude: number | null; activeRanges?: WeatherActiveRange[] };
type OpenMeteoPayload = { daily?: OpenMeteoDaily };
type LocatedWeather = LocationWeather & { locationKey: string };

function validCoordinate(latitude: number | null, longitude: number | null): latitude is number {
  return latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

async function fetchSegment(endpoint: string, locations: { key: string; latitude: number; longitude: number }[], from: string, to: string): Promise<LocatedWeather[]> {
  if (from > to || !locations.length) return [];
  const url = new URL(endpoint);
  url.searchParams.set("latitude", locations.map((location) => location.latitude.toFixed(4)).join(","));
  url.searchParams.set("longitude", locations.map((location) => location.longitude.toFixed(4)).join(","));
  url.searchParams.set("start_date", from);
  url.searchParams.set("end_date", to);
  url.searchParams.set("daily", "weather_code,temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum");
  url.searchParams.set("timezone", "Europe/Madrid");
  const response = await fetch(url, { next: { revalidate: 21_600 }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error(`Weather provider returned ${response.status}`);
  const payload = await response.json() as OpenMeteoPayload | OpenMeteoPayload[];
  const results = Array.isArray(payload) ? payload : [payload];
  if (results.length !== locations.length) throw new Error("Weather provider returned an incomplete location set");
  const expectedDays: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) expectedDays.push(day);
  return results.flatMap((result, index) => {
    const rows = parseOpenMeteoDaily(result.daily);
    if (rows.length !== expectedDays.length || rows.some((row, dayIndex) => row.day !== expectedDays[dayIndex])) throw new Error("Weather provider returned an incomplete daily series");
    return rows.map((row) => ({ ...row, locationKey: locations[index].key }));
  });
}

const cachedWeather = unstable_cache(async (locations: { key: string; latitude: number; longitude: number }[], from: string, to: string, today: string) => {
  const archiveTo = [to, shiftDay(today, -5)].sort()[0];
  const recentFrom = [from, shiftDay(today, -4)].sort().at(-1)!;
  const chunks = Array.from({ length: Math.ceil(locations.length / 50) }, (_, index) => locations.slice(index * 50, index * 50 + 50));
  const rows = await Promise.all(chunks.flatMap((chunk) => [
    fetchSegment("https://archive-api.open-meteo.com/v1/archive", chunk, from, archiveTo),
    fetchSegment("https://api.open-meteo.com/v1/forecast", chunk, recentFrom, to),
  ]));
  return rows.flat();
}, ["open-meteo-daily-v2"], { revalidate: 21_600 });

export async function getDailyWeather(locations: WeatherLocation[], from: string, to: string, today: string): Promise<{ weather: DailyWeather[]; locationCount: number; error?: string }> {
  const unique = new Map<string, { key: string; latitude: number; longitude: number; activeRanges: WeatherActiveRange[] }>();
  for (const location of locations) {
    if (!validCoordinate(location.latitude, location.longitude)) continue;
    const key = `${location.latitude.toFixed(4)},${location.longitude!.toFixed(4)}`;
    const current = unique.get(key) ?? { key, latitude: location.latitude, longitude: location.longitude!, activeRanges: [] };
    current.activeRanges.push(...(location.activeRanges ?? [{ from, to }]));
    unique.set(key, current);
  }
  if (!unique.size) return { weather: [], locationCount: 0, error: "No machine coordinates are available for weather." };
  try {
    const entries = [...unique.values()];
    const rows = await cachedWeather(entries.map(({ key, latitude, longitude }) => ({ key, latitude, longitude })), from, to, today);
    const scopedRows = filterWeatherByActiveRanges(rows, new Map(entries.map((entry) => [entry.key, entry.activeRanges])));
    const weather = aggregateDailyWeather(scopedRows);
    return { weather, locationCount: entries.length, ...(weather.length ? {} : { error: "Weather is unavailable for this period." }) };
  } catch (error) {
    return { weather: [], locationCount: unique.size, error: error instanceof Error ? error.message : "Weather is unavailable." };
  }
}
