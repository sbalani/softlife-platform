const LABELS: Record<string, { text: string; cls: string }> = {
  supabase: { text: "● Cached — Supabase", cls: "text-taupe" },
  huaxin: { text: "● Live — Huaxin cloud (real-time)", cls: "text-sage" },
  sample: { text: "Sample data — add Huaxin or Supabase keys to .env.local to see live data.", cls: "text-taupe" },
};

export function DataSourceNote({ source }: { source: "supabase" | "huaxin" | "sample" }) {
  const l = LABELS[source] ?? LABELS.sample;
  return <p className={`mt-4 text-xs ${l.cls}`}>{l.text}</p>;
}
