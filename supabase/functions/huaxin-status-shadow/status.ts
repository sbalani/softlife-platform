export type ShadowStatusRow = {
  code?: string;
  desc?: string;
  value?: unknown;
  data?: unknown;
};

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, nested]) => [key, stable(nested)]));
}

export function canonicalStatuses(rows: ShadowStatusRow[]) {
  const unique = new Map<string, { code: string; desc: string; value: unknown; data: unknown }>();
  rows.forEach((row, index) => {
    const code = String(row.code ?? `index:${index}`);
    unique.set(code, {
      code,
      desc: String(row.desc ?? ""),
      value: stable(row.value ?? null),
      data: stable(row.data ?? null),
    });
  });
  return [...unique.values()].sort((a, b) => a.code.localeCompare(b.code));
}

export async function statusHash(rows: ShadowStatusRow[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalStatuses(rows)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
