import { getSessionProfile } from "@/lib/auth/session";
import { getPayoutReports } from "@/lib/data/franchisee-profit";
import { getTenantBankDetails } from "@/lib/data/franchisees";
import { validPayoutRange } from "@/lib/payout-report";
import { createPayoutArchive } from "@/lib/payout-archive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function privateResponse(body: BodyInit | null, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(body, { ...init, headers });
}

export async function POST(request: Request) {
  const actor = await getSessionProfile();
  if (!actor) return privateResponse("Authentication required.", { status: 401 });
  if (actor.role !== "admin") return privateResponse("Forbidden.", { status: 403 });
  const form = await request.formData();
  const from = String(form.get("dateFrom") ?? "");
  const to = String(form.get("dateTo") ?? "");
  if (!validPayoutRange(from, to)) return privateResponse("A valid dateFrom/dateTo range is required.", { status: 400 });
  const mode = form.get("mode") === "all" ? "all" : "selected";
  const requestedTenantIds = [...new Set(form.getAll("tenantId").map(String))];
  if (mode === "selected" && (!requestedTenantIds.length || requestedTenantIds.length > 100 || requestedTenantIds.some((id) => !UUID.test(id)))) {
    return privateResponse("Select between 1 and 100 valid franchisees.", { status: 400 });
  }
  const includeBankDetails = form.get("includeBankDetails") === "true";
  try {
    const reports = await getPayoutReports(from, to, mode === "all" ? undefined : requestedTenantIds);
    if (!reports.length) return privateResponse("No positive franchisee payouts match this period and selection.", { status: 404 });
    if (reports.length > 100) return privateResponse("The bulk export is limited to 100 franchisees.", { status: 400 });
    const archiveReports = await Promise.all(reports.map(async (report) => {
      const storedBank = includeBankDetails ? await getTenantBankDetails(report.tenantId) : null;
      const bankDetails = storedBank ? {
        accountHolderName: storedBank.account_holder_name, iban: storedBank.iban,
        bicSwift: storedBank.bic_swift, bankName: storedBank.bank_name,
      } : null;
      return { ...report, bankDetails };
    }));
    const archive = await createPayoutArchive({ from, to, reports: archiveReports, bankDetailsRequested: includeBankDetails });
    return privateResponse(archive as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="payouts-${from}-${to}.zip"`,
      },
    });
  } catch (error) {
    console.error("[bulk-payout-export] Report generation failed:", error);
    return privateResponse("Unable to generate payout statements.", { status: 503 });
  }
}
