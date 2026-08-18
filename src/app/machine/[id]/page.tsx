import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getMachineService } from "@/lib/data/machine-service";
import { formatDateTime } from "@/lib/dates";
import { getDisplayTimezone } from "@/lib/timezone";
import { ActionReportForm } from "@/components/ActionReportForm";

export const dynamic = "force-dynamic";

export default async function MachineServicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await getSessionProfile();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/machine/${id}`)}`);
  const [machine, tz] = await Promise.all([getMachineService(id, session), getDisplayTimezone()]);
  if (!machine) notFound();
  const appUrl = `softlife-haccp:///machine/${encodeURIComponent(id)}`;

  return (
    <main className="min-h-screen bg-cream px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 rounded-2xl bg-cocoa p-5 text-white shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Machine service</p>
          <h1 className="mt-1 font-display text-3xl font-bold">{machine.name}</h1>
          <p className="mt-1 text-sm text-white/70">{machine.warehouseName ? `Warehouse: ${machine.warehouseName}` : "No service warehouse assigned"}</p>
          <p className="mt-1 text-xs text-white/60">Last full clean: {machine.lastFullClean ? formatDateTime(machine.lastFullClean, tz) : "never recorded"}</p>
          <div className="mt-4 flex flex-wrap gap-3"><a href={appUrl} className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-cocoa">Open in SoftLife HACCP app</a>{session.role === "admin" && machine.imei && <Link href={`/machines/${machine.imei}`} className="rounded-lg border border-white/30 px-4 py-2 text-sm font-bold text-white">Machine dashboard</Link>}</div>
        </header>
        <ActionReportForm
          machines={[{ id: machine.id, name: machine.name, warehouseId: machine.warehouseId }]}
          lots={machine.lots.map((lot) => ({
            odooId: lot.odoo_id,
            name: lot.name,
            productName: lot.product_name,
            available: lot.available,
            warehouseId: machine.warehouseId!,
          }))}
          source="machine_qr"
          initialEventTime={new Date().toISOString()}
        />
        <p className="mt-6 text-center text-xs text-taupe">Signed in as {session.full_name ?? session.email ?? "operator"}</p>
      </div>
    </main>
  );
}
