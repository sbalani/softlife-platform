import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type TempReading = {
  machine_name: string;
  reading_time: string;
  series_name: string;
  value: number;
};

const SAMPLE: TempReading[] = [
  { machine_name: "B84MAX-001", reading_time: "2026-07-01T09:00:00Z", series_name: "Cylinder", value: -4.2 },
  { machine_name: "B84MAX-002", reading_time: "2026-07-01T09:00:00Z", series_name: "Cylinder", value: -3.8 },
  { machine_name: "B84MAX-003", reading_time: "2026-07-01T08:45:00Z", series_name: "Hopper", value: -2.1 },
];

export async function getLatestTemperatures(): Promise<{ temps: TempReading[]; source: "supabase" | "sample" }> {
  if (!isSupabaseConfigured()) return { temps: SAMPLE, source: "sample" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("v_latest_temps").select("*");
    if (error || !data) return { temps: SAMPLE, source: "sample" };
    return { temps: data as TempReading[], source: "supabase" };
  } catch {
    return { temps: SAMPLE, source: "sample" };
  }
}
