import { getSessionProfile } from "@/lib/auth/session";
import { getTenantPayoutReport } from "@/lib/data/franchisee-profit";
import { authorizePayoutTenant, createPayoutPdf, validPayoutRange } from "@/lib/payout-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function privateResponse(body: BodyInit | null, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  return new Response(body, { ...init, headers });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const authorization = authorizePayoutTenant(await getSessionProfile(), url.searchParams.get("tenantId"));
  if (!authorization.allowed) {
    const message = authorization.status === 401 ? "Authentication required." : authorization.status === 403 ? "Forbidden." : "tenantId is required.";
    return privateResponse(message, { status: authorization.status });
  }

  const from = url.searchParams.get("dateFrom");
  const to = url.searchParams.get("dateTo");
  if (!validPayoutRange(from, to)) return privateResponse("A valid dateFrom/dateTo range is required.", { status: 400 });

  try {
    const report = await getTenantPayoutReport(authorization.tenantId, from, to!);
    if (!report) return privateResponse("Franchisee tenant not found.", { status: 404 });
    const pdf = await createPayoutPdf({ franchiseeName: report.tenantName, from, to: to!, rows: report.rows });
    const safeTenant = report.tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "franchisee";
    return privateResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="payout-${safeTenant}-${from}-${to}.pdf"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[payout-export] Report generation failed:", error);
    return privateResponse("Unable to generate payout statement.", { status: 503 });
  }
}
