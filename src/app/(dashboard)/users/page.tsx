import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { CreateUserForm } from "./CreateUserForm";
import { UserRow, type UserRowData } from "./UserRow";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const session = await getSessionProfile();
  if (!session || session.role !== "admin") redirect("/refills");

  let users: UserRowData[] = [];
  if (isSupabaseConfigured()) {
    const s = await createServiceClient();
    const { data } = await s.from("profiles").select("id,email,full_name,role").order("email");
    users = ((data as Record<string, unknown>[]) ?? []).map((u) => ({
      id: u.id as string,
      email: (u.email as string) ?? null,
      full_name: (u.full_name as string) ?? null,
      role: (u.role as string) === "admin" ? "admin" : "operator",
      isSelf: u.id === session.id,
    }));
  }

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Users</h1>
        <p className="mt-1 text-sm text-taupe">
          Admins get full access. Operators are limited to Refills — this is the same login the mobile app will use.
        </p>
      </header>

      <section className="mb-8 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Create user</h2>
        <CreateUserForm />
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold text-cocoa">All users ({users.length})</h2>
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line bg-sand/40 text-left text-[11px] uppercase tracking-wide text-taupe">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow key={u.id} user={u} />
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
