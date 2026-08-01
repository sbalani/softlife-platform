import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { CreateUserForm } from "./CreateUserForm";
import { UserRow, type UserRowData } from "./UserRow";
import { getTenants } from "@/lib/data/franchisees";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") redirect("/refills");

  let users: UserRowData[] = [];
  let machines: { id: string; name: string }[] = [];
  const tenants = await getTenants();
  if (isSupabaseConfigured()) {
    const s = await createServiceClient();
    const [{ data }, { data: machineRows }, { data: assignmentRows }] = await Promise.all([
      s.from("profiles").select("id,email,full_name,role,employer_kind,tenant_id").order("email"),
      s.from("machines").select("id,name,display_name").order("name"),
      s.from("user_machine_assignments").select("user_id,machine_id").lte("starts_at", new Date().toISOString()).or(`ends_at.is.null,ends_at.gte.${new Date().toISOString()}`),
    ]);
    const assignments = (assignmentRows as { user_id: string; machine_id: string }[]) ?? [];
    machines = ((machineRows as Record<string, unknown>[]) ?? []).map((machine) => ({ id: machine.id as string, name: (machine.display_name as string) || machine.name as string }));
    users = ((data as Record<string, unknown>[]) ?? []).map((u) => ({
      id: u.id as string,
      email: (u.email as string) ?? null,
      full_name: (u.full_name as string) ?? null,
      role: (["admin", "franchisee"].includes(u.role as string) ? u.role : "operator") as UserRowData["role"],
      employer_kind: (["franchisee", "contractor"].includes(u.employer_kind as string) ? u.employer_kind : "softlife") as UserRowData["employer_kind"],
      tenant_id: (u.tenant_id as string) ?? null,
      assigned_machine_ids: assignments.filter((assignment) => assignment.user_id === u.id).map((assignment) => assignment.machine_id),
      isSelf: u.id === session.id,
    }));
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Users</h1>
        <p className="mt-1 text-sm text-taupe">
          Admins see all machines. Operators use explicit assignments. Franchisees see and service their franchise machines.
        </p>
      </header>

      <section className="mb-8 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Create user</h2>
        <CreateUserForm tenants={tenants.map(({ id, name }) => ({ id, name }))} />
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">All users ({users.length})</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line bg-sand/40 text-left text-[11px] uppercase tracking-wide text-taupe">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Access &amp; assignments</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                  <UserRow key={u.id} user={u} tenants={tenants.map(({ id, name }) => ({ id, name }))} machines={machines} />
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-taupe">No users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
