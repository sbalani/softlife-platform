export type RecallRow = Record<string, unknown> & { machine_id?: unknown; device_imei?: unknown; machine_name?: unknown; device_event_time?: unknown };

export function latestRecallRows(legacy: RecallRow[], canonical: RecallRow[], allowedMachineIds: string[] | null) {
  const rows = [...legacy, ...canonical]
    .filter((row) => !allowedMachineIds || allowedMachineIds.includes(String(row.machine_id)))
    .sort((a, b) => Date.parse(String(b.device_event_time)) - Date.parse(String(a.device_event_time)));
  const latest = new Map<string, RecallRow>();
  for (const row of rows) {
    const key = String(row.machine_id ?? row.device_imei ?? row.machine_name);
    if (!latest.has(key)) latest.set(key, row);
  }
  return [...latest.values()];
}
