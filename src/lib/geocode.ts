/** Free geocoding via Nominatim (OpenStreetMap) — no API key. Their usage
 *  policy requires an identifying User-Agent and ≤1 request/second; callers
 *  looping over machines must throttle. */
export function normalizeGeocodeAddress(address: string): string {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const streetIndex = parts.findIndex((part) => /^(?:C\.|C\/|Calle|Av\.|Avenida)\s+/i.test(part));
  const searchable = streetIndex > 0 ? parts.slice(streetIndex) : parts;
  return searchable.join(", ").replace(/^C\.\s+/i, "Calle ").replace(/^C\/\s*/i, "Calle ");
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const query = normalizeGeocodeAddress(address);
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "softlife-platform/1.0 (machine fleet dashboard)" },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { lat?: string; lon?: string }[];
  const hit = rows[0];
  if (!hit?.lat || !hit?.lon) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon) };
}
