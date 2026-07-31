export function fleetFreshness(timestamps: (string | null)[], now = Date.now(), maxAgeHours = 26) {
  const valid = timestamps.filter((timestamp): timestamp is string => !!timestamp);
  const staleBefore = now - maxAgeHours * 3_600_000;
  return {
    latest: valid.sort().at(-1) ?? null,
    stale: timestamps.filter((timestamp) => !timestamp || Date.parse(timestamp) < staleBefore).length,
  };
}
