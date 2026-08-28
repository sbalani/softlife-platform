import { cookies } from "next/headers";
import { normalizeLocale } from "./locale";

export async function getRequestLocale() {
  return normalizeLocale((await cookies()).get("softlife-locale")?.value);
}
