import { formatDate, ymd } from "./dates.ts";

export function manufacturingOverlapGuidance(input: {
  periodFrom: string;
  periodTo: string;
  timeZone: string;
  status: string;
}) {
  const end = new Date(input.periodTo);
  if (!Number.isFinite(end.getTime()) || end.getTime() <= Date.parse(input.periodFrom)) return null;
  const from = formatDate(input.periodFrom, input.timeZone);
  const through = formatDate(new Date(end.getTime() - 1).toISOString(), input.timeZone);
  const nextDate = ymd(end, input.timeZone);
  const ownership = input.status === "completed"
    ? "These orders were already completed"
    : ["ready", "processing"].includes(input.status)
      ? "These orders were already released to Odoo"
      : "These orders are reserved";
  return `${ownership} in a manufacturing run covering ${from} through ${through}. To avoid duplicates, start the next run from ${nextDate}.`;
}
