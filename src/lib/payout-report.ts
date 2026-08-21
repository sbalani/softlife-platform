import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SessionProfile } from "./auth/session.ts";
import type { Order } from "./data/orders.ts";

export const PAYOUT_TIME_ZONE = "Europe/Madrid";

export type PayoutAssignment = {
  id: string;
  machine_id: string;
  tenant_id: string;
  start_date: string;
  end_date: string | null;
  share_percent: number;
  tenant_name: string;
  machine_name: string;
  device_imei: string | null;
};

export type PayoutVatRate = { rate_percent: number; effective_from: string };

export type PayoutRow = {
  assignmentId: string;
  tenantId: string;
  tenantName: string;
  machineId: string;
  machineName: string;
  deviceImei: string | null;
  period: string;
  sharePercent: number;
  gross: number;
  vat: number;
  net: number;
  payout: number;
  orders: number;
};

function madridDay(timestamp: string): string | null {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PAYOUT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function calculatePayoutRows(
  orders: Order[],
  assignments: PayoutAssignment[],
  vatRates: PayoutVatRate[],
  range?: { from: string; to: string },
): PayoutRow[] {
  const rows = new Map<string, PayoutRow>();
  const sortedRates = [...vatRates].sort((a, b) => b.effective_from.localeCompare(a.effective_from));

  for (const order of orders) {
    if (!order.machine_id || order.order_state !== "COMPLETE" || order.is_admin_override || order.refund_status === "Refunded") continue;
    const orderDate = madridDay(order.order_time);
    if (!orderDate || (range && (orderDate < range.from || orderDate > range.to))) continue;
    const assignment = assignments
      .filter((item) => item.machine_id === order.machine_id && item.start_date <= orderDate && (!item.end_date || item.end_date >= orderDate))
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    if (!assignment) continue;

    const vatRate = sortedRates.find((rate) => rate.effective_from <= orderDate)?.rate_percent ?? 10;
    const gross = order.price;
    const net = gross / (1 + vatRate / 100);
    const periodFrom = range && range.from > assignment.start_date ? range.from : assignment.start_date;
    const assignmentTo = assignment.end_date ?? "Ongoing";
    const periodTo = range && (assignmentTo === "Ongoing" || range.to < assignmentTo) ? range.to : assignmentTo;
    const row = rows.get(assignment.id) ?? {
      assignmentId: assignment.id,
      tenantId: assignment.tenant_id,
      tenantName: assignment.tenant_name,
      machineId: assignment.machine_id,
      machineName: assignment.machine_name,
      deviceImei: assignment.device_imei,
      period: `${periodFrom} to ${periodTo}`,
      sharePercent: assignment.share_percent,
      gross: 0,
      vat: 0,
      net: 0,
      payout: 0,
      orders: 0,
    };
    row.gross += gross;
    row.vat += gross - net;
    row.net += net;
    row.payout += net * (assignment.share_percent / 100);
    row.orders += 1;
    rows.set(assignment.id, row);
  }

  return [...rows.values()].sort((a, b) => b.payout - a.payout || a.machineName.localeCompare(b.machineName));
}

export type PayoutAuthorization =
  | { allowed: true; tenantId: string }
  | { allowed: false; status: 401 | 403 | 400 };

export function authorizePayoutTenant(
  actor: Pick<SessionProfile, "role" | "tenant_id"> | null,
  requestedTenantId: string | null,
): PayoutAuthorization {
  if (!actor) return { allowed: false, status: 401 };
  if (actor.role === "operator") return { allowed: false, status: 403 };
  if (actor.role === "admin") return requestedTenantId ? { allowed: true, tenantId: requestedTenantId } : { allowed: false, status: 400 };
  if (!actor.tenant_id) return { allowed: false, status: 403 };
  if (requestedTenantId && requestedTenantId !== actor.tenant_id) return { allowed: false, status: 403 };
  return { allowed: true, tenantId: actor.tenant_id };
}

export function validPayoutRange(from: string | null, to: string | null): from is string {
  const valid = (value: string | null) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!from || !to || !valid(from) || !valid(to) || from > to) return false;
  return Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) <= 365 * 86_400_000;
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  const printable = [...text].map((character) => {
    try {
      font.encodeText(character);
      return character;
    } catch {
      return "?";
    }
  }).join("");
  if (font.widthOfTextAtSize(printable, size) <= width) return printable;
  let value = printable;
  while (value && font.widthOfTextAtSize(`${value}...`, size) > width) value = value.slice(0, -1);
  return `${value}...`;
}

export async function createPayoutPdf(input: {
  franchiseeName: string;
  from: string;
  to: string;
  rows: PayoutRow[];
}): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`Payout statement - ${input.franchiseeName}`);
  document.setSubject(`Payout period ${input.from} to ${input.to}`);
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const columns = [36, 210, 363, 410, 457, 518, 579, 647];
  const widths = [168, 147, 41, 41, 55, 55, 62, 158];
  let page: PDFPage;
  let y: number;

  const addPage = (first = false) => {
    page = document.addPage([841.89, 595.28]);
    y = 558;
    if (first) {
      page.drawText(fit(input.franchiseeName, bold, 24, 770), { x: 36, y, size: 24, font: bold, color: rgb(0.19, 0.12, 0.09) });
      y -= 28;
      page.drawText("Franchisee payout statement", { x: 36, y, size: 13, font: bold, color: rgb(0.35, 0.55, 0.45) });
      y -= 20;
      page.drawText(`Period: ${input.from} to ${input.to} (Europe/Madrid)`, { x: 36, y, size: 10, font: regular });
      y -= 30;
    } else {
      page.drawText(fit(`${input.franchiseeName} - payout statement`, bold, 13, 770), { x: 36, y, size: 13, font: bold });
      y -= 25;
    }
    const headings = ["Machine", "Assignment period", "Share", "Orders", "Gross EUR", "VAT EUR", "Net EUR", "Payout EUR"];
    page.drawRectangle({ x: 32, y: y - 6, width: 777, height: 20, color: rgb(0.93, 0.91, 0.87) });
    headings.forEach((heading, index) => page.drawText(heading, { x: columns[index], y, size: 8, font: bold }));
    y -= 19;
  };

  addPage(true);
  if (input.rows.length === 0) {
    page!.drawText("No eligible completed sales were recorded for this period.", { x: 36, y: y! - 8, size: 11, font: regular });
    y! -= 35;
  } else {
    for (const row of input.rows) {
      if (y! < 68) addPage();
      const values = [
        row.deviceImei ? `${row.machineName} (${row.deviceImei})` : row.machineName,
        row.period,
        `${row.sharePercent.toFixed(2)}%`,
        String(row.orders),
        row.gross.toFixed(2),
        row.vat.toFixed(2),
        row.net.toFixed(2),
        row.payout.toFixed(2),
      ];
      values.forEach((value, index) => page!.drawText(fit(value, regular, 8, widths[index]), { x: columns[index], y: y!, size: 8, font: regular }));
      page!.drawLine({ start: { x: 32, y: y! - 5 }, end: { x: 809, y: y! - 5 }, thickness: 0.4, color: rgb(0.82, 0.82, 0.82) });
      y! -= 18;
    }
  }

  if (y! < 60) addPage();
  const totals = input.rows.reduce((sum, row) => ({
    orders: sum.orders + row.orders,
    gross: sum.gross + row.gross,
    vat: sum.vat + row.vat,
    net: sum.net + row.net,
    payout: sum.payout + row.payout,
  }), { orders: 0, gross: 0, vat: 0, net: 0, payout: 0 });
  page!.drawText("TOTAL", { x: columns[1], y: y!, size: 9, font: bold });
  [String(totals.orders), totals.gross.toFixed(2), totals.vat.toFixed(2), totals.net.toFixed(2), totals.payout.toFixed(2)]
    .forEach((value, index) => page!.drawText(value, { x: columns[index + 3], y: y!, size: 9, font: bold }));

  return document.save();
}
