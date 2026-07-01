/** Huaxin machine-cloud bridge (TypeScript port).
 *
 * Auth model: Huaxin issues a FIXED credential block (mch_id, mch_secret,
 * nonce_str, time_Stamp, sign). The block is sent verbatim on every call —
 * there is NO per-request signature computation. Verified live against UAT.
 */
export type HuaxinConfig = {
  baseUrl: string;
  mchId: string;
  mchSecret: string;
  sign: string;
  nonceStr: string;
  timeStamp: string;
  notifyUrl: string;
  verifySsl: boolean;
};

export type HuaxinDevice = {
  deviceId?: string;
  deviceName?: string;
  deviceImei?: string;
  deviceType?: string;
  location?: string;
  [k: string]: unknown;
};

type Envelope = {
  code?: number;
  msg?: string;
  data?: unknown;
  jsessionId?: string;
  result?: boolean;
};

const AUTH_TTL_MS = 15 * 60 * 1000;
let session: { auth: string; jsid: string; at: number } | null = null;

export function getConfigFromEnv(): HuaxinConfig | null {
  const baseUrl = process.env.HUAXIN_BASE_URL;
  const mchId = process.env.HUAXIN_MCH_ID;
  const mchSecret = process.env.HUAXIN_MCH_SECRET;
  const sign = process.env.HUAXIN_SIGN;
  if (!baseUrl || !mchId || !mchSecret || !sign) return null;
  return {
    baseUrl,
    mchId,
    mchSecret,
    sign,
    nonceStr: process.env.HUAXIN_NONCE_STR ?? "",
    timeStamp: process.env.HUAXIN_TIME_STAMP ?? "",
    notifyUrl: process.env.HUAXIN_NOTIFY_URL ?? "",
    verifySsl: process.env.HUAXIN_VERIFY_SSL !== "false",
  };
}

function commonParams(cfg: HuaxinConfig) {
  return {
    mch_id: cfg.mchId,
    mch_secret: cfg.mchSecret,
    nonce_str: cfg.nonceStr,
    time_Stamp: cfg.timeStamp,
    create_ip: "127.0.0.1",
    notify_url: cfg.notifyUrl,
    sign: cfg.sign,
  };
}

async function request(
  path: string,
  cfg: HuaxinConfig,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<Envelope> {
  const url = cfg.baseUrl.replace(/\/$/, "") + path;
  const init: RequestInit & { dispatcher?: unknown } = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify({ ...commonParams(cfg), ...(extra ?? {}) }),
  };
  if (cfg.verifySsl === false) {
    // UAT certificate is currently expired — bypass only when explicitly disabled.
    const { Agent } = await import("undici");
    init.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  const res = await fetch(url, init);
  return (await res.json()) as Envelope;
}

export async function authorize(cfg: HuaxinConfig) {
  const data = await request("/machine/cloud/api/authorize", cfg);
  if (String(data.code) !== "200") {
    throw new Error(`Huaxin authorize failed: ${data.msg ?? "unknown"}`);
  }
  const auth = (data.data as { authorization?: string })?.authorization;
  const jsid = data.jsessionId;
  if (!auth || !jsid) throw new Error("Huaxin authorize: missing token in response");
  session = { auth, jsid, at: Date.now() };
  return session;
}

async function getSession(cfg: HuaxinConfig) {
  if (session && Date.now() - session.at < AUTH_TTL_MS) return session;
  return authorize(cfg);
}

export async function call(
  path: string,
  cfg: HuaxinConfig,
  extra?: Record<string, unknown>,
): Promise<Envelope> {
  const { auth, jsid } = await getSession(cfg);
  const headers = {
    Authorization: auth,
    Cookie: `JSESSIONID=${jsid};SESSION=${jsid}`,
    jsessionId: jsid,
  };
  const data = await request(path, cfg, extra, headers);
  // Auto re-auth once on auth-related failure.
  if (String(data.code) === "208" && (data.msg ?? "").toLowerCase().includes("auth")) {
    await authorize(cfg);
    return call(path, cfg, extra);
  }
  return data;
}

export async function listDevices(cfg: HuaxinConfig): Promise<HuaxinDevice[]> {
  const data = await call("/machine/cloud/api/devices", cfg);
  const payload = data.data;
  const rows: HuaxinDevice[] = Array.isArray(payload)
    ? payload
    : (payload as { list?: HuaxinDevice[]; devices?: HuaxinDevice[] })?.list ??
      (payload as { devices?: HuaxinDevice[] })?.devices ??
      [];
  return rows;
}

export async function pullTemperatures(
  cfg: HuaxinConfig,
  deviceImei: string,
  began?: string,
  end?: string,
) {
  const data = await call(
    "/machine/cloud/api/device/temperatures/trackings",
    cfg,
    { device_imei: deviceImei, began_time: began ?? "", end_time: end ?? "" },
  );
  return data.data as {
    category?: string[];
    dataset?: { seriesname?: string; data?: { value?: string }[] }[];
  };
}

export function isOrderWebhook(body: unknown): boolean {
  return !!body && typeof body === "object" && (body as { responType?: string }).responType === "order";
}
export function isFaultWebhook(body: unknown): boolean {
  return (
    !!body &&
    typeof body === "object" &&
    "subject" in (body as object) &&
    "deviceId" in (body as object)
  );
}
