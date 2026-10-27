import { strToU8, zipSync } from "fflate";
import type { BankDetails } from "./bank-details.ts";
import { createPayoutPdf, payoutTaxBreakdown, type PayoutRow } from "./payout-report.ts";

export type PayoutArchiveReport = {
  tenantId: string;
  tenantName: string;
  rows: PayoutRow[];
  total: number;
  bankDetails: BankDetails | null;
  recipientLegalName?: string | null;
  recipientTaxId?: string | null;
  recipientAddress?: string | null;
};

function filenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "franchisee";
}

function csv(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export async function createPayoutArchive(input: {
  from: string;
  to: string;
  reports: PayoutArchiveReport[];
  bankDetailsRequested: boolean;
}): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const manifest = [["tenant_id", "franchisee", "total_payable_eur", "bank_details", "filename"]];
  for (const report of input.reports) {
    const filename = `payout-${filenamePart(report.tenantName)}-${report.tenantId.slice(0, 8)}-${input.from}-${input.to}.pdf`;
    files[filename] = await createPayoutPdf({
      franchiseeName: report.tenantName, from: input.from, to: input.to,
      rows: report.rows,
      paymentDetails: report.bankDetails && report.recipientLegalName && report.recipientTaxId ? {
        recipientLegalName: report.recipientLegalName,
        recipientTaxId: report.recipientTaxId,
        recipientAddress: report.recipientAddress ?? null,
        bankDetails: report.bankDetails,
      } : null,
    });
    manifest.push([
      report.tenantId, report.tenantName, payoutTaxBreakdown(report.total).total.toFixed(2),
      input.bankDetailsRequested ? report.bankDetails ? "included" : "unavailable" : "not requested",
      filename,
    ]);
  }
  files["manifest.csv"] = strToU8(manifest.map((row) => row.map(csv).join(",")).join("\n") + "\n");
  return zipSync(files, { level: 6 });
}
