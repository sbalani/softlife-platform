"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { normalizeLocale, type Locale } from "@/lib/i18n/locale";

export async function setLocale(value: Locale) {
  const locale = normalizeLocale(value);
  (await cookies()).set("softlife-locale", locale, { path: "/", maxAge: 365 * 24 * 60 * 60, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
}
