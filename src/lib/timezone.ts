import { cookies } from "next/headers";
import { DEFAULT_TZ } from "./dates";

export async function getDisplayTimezone(): Promise<string> {
  const c = await cookies();
  return c.get("display-tz")?.value ?? DEFAULT_TZ;
}
