import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { FRANCHISEE_CONTRACT_VERSION } from "@/lib/franchisee-onboarding-contract";
import type { TenantContractAcceptancePayload } from "@/lib/franchisee-contract-acceptance";

export type FranchiseeContractAcceptance = {
  id: string;
  tenant_id: string;
  profile_id: string;
  accepted_at: string;
  contract_version: string;
  pdf_storage_path: string;
  pdf_sha256: string;
  canonical_source?: TenantContractAcceptancePayload;
};

const SELECT = "id,tenant_id,profile_id,accepted_at,contract_version,pdf_storage_path,pdf_sha256";

export async function getCurrentTenantContractAcceptance(tenantId: string): Promise<FranchiseeContractAcceptance | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await (await createServiceClient()).from("franchisee_contract_acceptances")
    .select(`${SELECT},canonical_source`).eq("tenant_id", tenantId).eq("contract_version", FRANCHISEE_CONTRACT_VERSION).maybeSingle();
  if (error) throw error;
  return data as FranchiseeContractAcceptance | null;
}

export async function getCurrentContractAcceptances(tenantIds: string[]): Promise<FranchiseeContractAcceptance[]> {
  if (!isSupabaseConfigured() || tenantIds.length === 0) return [];
  const { data, error } = await (await createServiceClient()).from("franchisee_contract_acceptances")
    .select(SELECT).eq("contract_version", FRANCHISEE_CONTRACT_VERSION).in("tenant_id", tenantIds);
  if (error) throw error;
  return (data as FranchiseeContractAcceptance[]) ?? [];
}
