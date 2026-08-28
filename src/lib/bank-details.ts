export type BankDetails = {
  accountHolderName: string;
  iban: string;
  bicSwift: string | null;
  bankName: string | null;
};

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;
  for (const character of rearranged) {
    const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

export function normalizeBic(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function isValidBic(value: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(value));
}

export function bankDetailsFromForm(formData: FormData): { details: BankDetails | null; error?: string } {
  const accountHolderName = String(formData.get("account_holder_name") ?? "").trim();
  const iban = normalizeIban(String(formData.get("iban") ?? ""));
  const bicSwift = normalizeBic(String(formData.get("bic_swift") ?? "")) || null;
  const bankName = String(formData.get("bank_name") ?? "").trim() || null;
  if (!accountHolderName && !iban && !bicSwift && !bankName) return { details: null };
  if (!accountHolderName || accountHolderName.length > 150) return { details: null, error: "Enter the bank account holder name." };
  if (!isValidIban(iban)) return { details: null, error: "Enter a valid IBAN." };
  if (bicSwift && !isValidBic(bicSwift)) return { details: null, error: "Enter a valid BIC/SWIFT code." };
  if (bankName && bankName.length > 150) return { details: null, error: "Bank name is too long." };
  return { details: { accountHolderName, iban, bicSwift, bankName } };
}

export function maskIban(value: string): string {
  const iban = normalizeIban(value);
  return iban.length < 8 ? "••••" : `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`;
}

export function payoutMissingFields(input: { companyName: string | null; taxId: string | null; hasBankAccount: boolean }): ("company" | "tax" | "bank")[] {
  const missing: ("company" | "tax" | "bank")[] = [];
  if (!input.companyName?.trim()) missing.push("company");
  if (!input.taxId?.trim()) missing.push("tax");
  if (!input.hasBankAccount) missing.push("bank");
  return missing;
}
