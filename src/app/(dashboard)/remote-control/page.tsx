import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { getAccessibleMachines } from "@/lib/data/accessible-machines";
import { RemoteControlPanel } from "./RemoteControlPanel";
import { createServiceClient } from "@/lib/supabase/server";
import { FRANCHISEE_CONFIGURABLE_COMMANDS, HUAXIN_REMOTE_COMMANDS } from "@/lib/huaxin/remote-commands";

export const dynamic = "force-dynamic";

export default async function RemoteControlPage() {
  const session = await getSessionProfile();
  if (!session || session.role === "operator") redirect("/refills");
  const machines = await getAccessibleMachines();
  let commands = [...HUAXIN_REMOTE_COMMANDS];
  if (session.role === "franchisee") {
    const { data: tenant, error } = await (await createServiceClient()).from("tenants").select("remote_commands").eq("id", session.tenant_id).maybeSingle();
    const allowed = new Set(error ? [] : (tenant?.remote_commands as string[] | null) ?? ["operate_make"]);
    commands = FRANCHISEE_CONFIGURABLE_COMMANDS.filter((item) => allowed.has(item.command));
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-terracotta">Franchise controls</p>
        <h1 className="mt-1 font-display text-3xl font-bold text-cocoa">Remote control</h1>
        <p className="mt-2 text-sm text-taupe">Select a machine, then confirm the command. Commands act on live equipment.</p>
      </header>
      <RemoteControlPanel machines={machines} commands={commands} />
    </div>
  );
}
