export function parseEuroCents(value: unknown): number | null {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const [euros, decimals = ""] = raw.split(".");
  const cents = Number(euros) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatEuroCents(cents: number) {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

export function cashDiscrepancyCents(expectedBeforeCents: number, withdrawalCents: number, physicalRemainderCents: number) {
  return physicalRemainderCents - (expectedBeforeCents - withdrawalCents);
}
