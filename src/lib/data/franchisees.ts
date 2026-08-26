import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type Tenant = {
  id: string;
  name: string;
  kind: string;
  remote_commands: string[];
  created_at: string;
  company_name: string | null;
  tax_id: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  website: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  tenant_contacts: TenantContact[];
};

export type TenantContact = {
  id: string;
  full_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
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

export type FranchiseeSignupRequest = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  message: string | null;
  created_at: string;
};

export async function getTenants(): Promise<Tenant[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data } = await s
      .from("tenants")
      .select("id,name,kind,remote_commands,created_at,company_name,tax_id,contact_email,contact_phone,website,address_line_1,address_line_2,postal_code,city,province,country,tenant_contacts(id,full_name,job_title,email,phone,is_primary)")
      .order("name");
    return ((data as Tenant[]) ?? []).map((tenant) => ({
      ...tenant,
      tenant_contacts: [...(tenant.tenant_contacts ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.full_name.localeCompare(b.full_name)),
    }));
  } catch {
    return [];
  }
}

export async function getFranchiseeSignupRequests(): Promise<FranchiseeSignupRequest[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data, error } = await s.from("franchisee_signup_requests")
      .select("id,full_name,email,phone,company_name,message,created_at").eq("status", "pending").order("created_at", { ascending: false });
    if (error) throw error;
    return (data as FranchiseeSignupRequest[]) ?? [];
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
