import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getAccessibleMachines } from "@/lib/data/accessible-machines";
import { RemoteControlPanel } from "./RemoteControlPanel";

export const dynamic = "force-dynamic";

export default async function RemoteControlPage() {
  const session = await getSessionProfile();
  if (!session || session.role === "operator") redirect("/refills");
  const machines = await getAccessibleMachines();

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-terracotta">Franchise controls</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-cocoa">Remote control</h1>
        <p className="mt-2 text-sm text-taupe">Select a machine, then confirm the command. Commands act on live equipment.</p>
      </header>
      <RemoteControlPanel machines={machines} />
    </div>
  );
}
