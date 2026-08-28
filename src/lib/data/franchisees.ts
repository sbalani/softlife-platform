import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { payoutMissingFields } from "@/lib/bank-details";

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

export type TenantBankDetails = {
  tenant_id: string;
  account_holder_name: string;
  iban: string;
  bic_swift: string | null;
  bank_name: string | null;
  updated_at: string;
};

export type TenantSummary = Pick<Tenant, "id" | "name" | "kind" | "created_at" | "company_name" | "tax_id" | "contact_email" | "contact_phone" | "city" | "country"> & {
  has_bank_details: boolean;
  payout_ready: boolean;
};

export type FranchiseeIntakeSubmission = {
  id: string;
  trade_name: string | null;
  company_name: string | null;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string;
  tax_id: string | null;
  account_holder_name: string | null;
  iban: string | null;
  bic_swift: string | null;
  status: "pending" | "processed";
  created_at: string;
};

export type FranchiseeSignupRequest = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  company_name: string | null;
  tax_id: string | null;
  account_holder_name: string | null;
  iban: string | null;
  bic_swift: string | null;
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

export async function getTenantSummaries(): Promise<TenantSummary[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const [tenants, bankDetails] = await Promise.all([
      s.from("tenants").select("id,name,kind,created_at,company_name,tax_id,contact_email,contact_phone,city,country").order("name"),
      s.from("tenant_bank_details").select("tenant_id"),
    ]);
    if (tenants.error) throw tenants.error;
    if (bankDetails.error) throw bankDetails.error;
    const bankTenantIds = new Set((bankDetails.data ?? []).map((row) => String(row.tenant_id)));
    return ((tenants.data as Omit<TenantSummary, "has_bank_details" | "payout_ready">[]) ?? []).map((tenant) => {
      const hasBankDetails = bankTenantIds.has(tenant.id);
      return { ...tenant, has_bank_details: hasBankDetails, payout_ready: Boolean(tenant.company_name && tenant.tax_id && hasBankDetails) };
    });
  } catch {
    return [];
  }
}

export async function getTenantById(tenantId: string): Promise<Tenant | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await (await createServiceClient()).from("tenants")
    .select("id,name,kind,remote_commands,created_at,company_name,tax_id,contact_email,contact_phone,website,address_line_1,address_line_2,postal_code,city,province,country,tenant_contacts(id,full_name,job_title,email,phone,is_primary)")
    .eq("id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const tenant = data as Tenant;
  tenant.tenant_contacts = [...(tenant.tenant_contacts ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.full_name.localeCompare(b.full_name));
  return tenant;
}

export async function getTenantBankDetails(tenantId: string): Promise<TenantBankDetails | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await (await createServiceClient()).from("tenant_bank_details")
    .select("tenant_id,account_holder_name,iban,bic_swift,bank_name,updated_at").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  return data as TenantBankDetails | null;
}

export async function getPayoutReadiness(tenantId: string) {
  if (!isSupabaseConfigured()) return { ready: false, missing: ["company", "tax", "bank"] as ("company" | "tax" | "bank")[] };
  const s = await createServiceClient();
  const [tenantResult, bankResult] = await Promise.all([
    s.from("tenants").select("kind,company_name,tax_id").eq("id", tenantId).maybeSingle(),
    s.from("tenant_bank_details").select("account_holder_name,iban").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (tenantResult.error) throw tenantResult.error;
  if (bankResult.error) throw bankResult.error;
  const tenant = tenantResult.data;
  const bank = bankResult.data;
  if (!tenant || tenant.kind !== "franchisee") return { ready: false, missing: ["company", "tax", "bank"] as const };
  const missing = payoutMissingFields({ companyName: tenant.company_name, taxId: tenant.tax_id, hasBankAccount: Boolean(bank?.account_holder_name && bank.iban) });
  return { ready: missing.length === 0, missing };
}

export async function getFranchiseeSignupRequests(): Promise<FranchiseeSignupRequest[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const s = await createServiceClient();
    const { data, error } = await s.from("franchisee_signup_requests")
      .select("id,full_name,email,phone,company_name,tax_id,account_holder_name,iban,bic_swift,message,created_at").eq("status", "pending").order("created_at", { ascending: false });
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
    const { data, error } = await s.from("franchisee_intake_submissions").select("id,trade_name,company_name,contact_name,contact_email,contact_phone,tax_id,account_holder_name,iban,bic_swift,status,created_at").eq("status", "pending").order("created_at", { ascending: false });
    if (error) throw error;
    return (data as FranchiseeIntakeSubmission[]) ?? [];
  } catch {
    return [];
  }
}
