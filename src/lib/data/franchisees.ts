import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type Tenant = {
  id: string;
  name: string;
  kind: string;
  created_at: string;
};

export type FranchiseeIntakeSubmission = {
  id: string;
  trade_name: string;
  company_name: string;
  contact_name: string;
  contact_phone: string;
  status: "pending" | "processed";
  created_at: string;
};

export async function getTenants(): Promise<Tenant[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("tenants")
      .select("id, name, kind, created_at")
      .order("name");
    return (data as Tenant[]) ?? [];
  } catch {
    return [];
  }
}

export async function getFranchiseeIntakeSubmissions(): Promise<FranchiseeIntakeSubmission[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data, error } = await s.from("franchisee_intake_submissions").select("id,trade_name,company_name,contact_name,contact_phone,status,created_at").eq("status", "pending").order("created_at", { ascending: false });
    if (error) throw error;
    return (data as FranchiseeIntakeSubmission[]) ?? [];
  } catch {
    return [];
  }
}
