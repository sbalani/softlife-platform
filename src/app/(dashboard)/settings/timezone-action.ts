"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

export async function setTimezone(tz: string): Promise<void> {
  const c = await cookies();
  c.set("display-tz", tz, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
