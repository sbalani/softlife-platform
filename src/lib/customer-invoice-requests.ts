import { sha256 } from "./odoo-sync-contract.ts";

export type CustomerFiscalDetails = {
  legal_name: string;
  tax_id: string;
  email: string;
  address: string;
  postal_code: string;
  city: string;
  province: string;
  country_code: string;
};

function required(value: unknown, label: string, maximum: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > maximum) throw new Error(`${label} is too long.`);
  return text;
}

export function parseCustomerFiscalDetails(value: Record<string, unknown>): CustomerFiscalDetails {
  const details = {
    legal_name: required(value.legal_name, "Legal name", 200),
    tax_id: required(value.tax_id, "Tax ID", 50).toUpperCase(),
    email: required(value.email, "Email", 254).toLowerCase(),
    address: required(value.address, "Address", 300),
    postal_code: required(value.postal_code, "Postal code", 20),
    city: required(value.city, "City", 100),
    province: required(value.province, "Province", 100),
    country_code: required(value.country_code, "Country code", 2).toUpperCase(),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email)) throw new Error("Enter a valid email address.");
  if (!/^[A-Z]{2}$/.test(details.country_code)) throw new Error("Country code must contain two letters.");
  return details;
}

export function customerFiscalDetailsHash(details: CustomerFiscalDetails) {
  return sha256(details);
}
