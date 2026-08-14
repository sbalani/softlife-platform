const required = ["HUAXIN_BASE_URL", "HUAXIN_MCH_ID", "HUAXIN_MCH_SECRET", "HUAXIN_SIGN", "SUPABASE_SERVICE_ROLE_KEY"];

if (process.env.VERCEL_ENV === "production") {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Cannot migrate defrost secrets; missing ${missing.join(", ")}`);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (!url) throw new Error("Cannot migrate defrost secrets; Supabase URL is missing");
  const response = await fetch(`${url}/rest/v1/rpc/configure_defrost_huaxin_config`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_base_url: process.env.HUAXIN_BASE_URL,
      p_mch_id: process.env.HUAXIN_MCH_ID,
      p_mch_secret: process.env.HUAXIN_MCH_SECRET,
      p_sign: process.env.HUAXIN_SIGN,
      p_nonce_str: process.env.HUAXIN_NONCE_STR || "",
      p_time_stamp: process.env.HUAXIN_TIME_STAMP || "",
      p_notify_url: process.env.HUAXIN_NOTIFY_URL || "",
    }),
  });
  if (!response.ok) throw new Error(`Defrost secret migration failed: ${response.status} ${await response.text()}`);
  console.log("Huaxin defrost configuration migrated to Supabase Vault.");
}
