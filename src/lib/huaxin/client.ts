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

export type HuaxinOrder = {
  orderCode?: string;
  outTradeNo?: string;
  price?: string | number;
  amount?: string | number;
  nums?: string | number;
  status?: string | number;
  payType?: string;
  payTime?: string;
  createTime?: string;
  productName?: string;
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
const DEVICES_TTL_MS = 60 * 1000; // cache the device list for 60s across pages
let session: { auth: string; jsid: string; at: number } | null = null;
let devicesCache: { at: number; rows: HuaxinDevice[] } | null = null;

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
  const body = JSON.stringify({ ...commonParams(cfg), ...(extra ?? {}) });
  const reqHeaders = { "Content-Type": "application/json", ...(headers ?? {}) };

  if (cfg.verifySsl === false) {
    // Use undici's own fetch (not the Next.js-patched global) so the dispatcher
    // — which disables TLS verification for the expired UAT cert — is honoured.
    const undici = await import("undici");
    const res = await undici.fetch(url, {
      method: "POST",
      headers: reqHeaders,
      body,
      dispatcher: new undici.Agent({ connect: { rejectUnauthorized: false } }),
    });
    return (await res.json()) as Envelope;
  }

  const res = await fetch(url, { method: "POST", headers: reqHeaders, body });
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

function rowsFrom(payload: unknown): HuaxinDevice[] {
  if (Array.isArray(payload)) return payload;
  const obj = payload as { list?: HuaxinDevice[]; devices?: HuaxinDevice[] } | null;
  return obj?.list ?? obj?.devices ?? [];
}

export async function listDevices(
  cfg: HuaxinConfig,
  opts: { force?: boolean } = {},
): Promise<HuaxinDevice[]> {
  if (!opts.force && devicesCache && Date.now() - devicesCache.at < DEVICES_TTL_MS) {
    return devicesCache.rows;
  }
  const data = await call("/machine/cloud/api/devices", cfg);
  const rows = rowsFrom(data.data);
  devicesCache = { at: Date.now(), rows };
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

export async function listOrders(
  cfg: HuaxinConfig,
  deviceImei: string,
  began?: string,
  end?: string,
  page = 1,
): Promise<HuaxinOrder[]> {
  const data = await call("/machine/cloud/api/device/orders", cfg, {
    device_imei: deviceImei,
    beganTime: began ?? "",
    endTime: end ?? "",
    page: String(page),
  });
  const payload = data.data;
  if (Array.isArray(payload)) return payload as HuaxinOrder[];
  const obj = payload as { list?: HuaxinOrder[]; orders?: HuaxinOrder[] } | null;
  return obj?.list ?? obj?.orders ?? [];
}

export type ProductDiyItem = {
  position?: string;
  goodsName?: string;
  price?: string;
  imagePath?: string;
  enable?: number;
};

export async function listDeviceProducts(cfg: HuaxinConfig, deviceImei: string): Promise<ProductDiyItem[]> {
  const data = await call("/machine/cloud/api/device/product", cfg, { device_imei: deviceImei });
  const payload = data.data as { productDiy?: ProductDiyItem[] } | null;
  return payload?.productDiy ?? [];
}

export async function pushProductDiy(
  cfg: HuaxinConfig,
  deviceImei: string,
  items: { position: string; code: string; value: string }[],
) {
  return call("/machine/cloud/api/batch/motify/data", cfg, {
    data: { serialNum: String(Date.now()), type: "productDiy", deviceImei, data: items },
  });
}

export async function refreshProduct(cfg: HuaxinConfig, deviceImei: string) {
  return sendCommand(cfg, deviceImei, "operate_refresh_product");
}

// ---- Remote control / status / media ----

export async function sendCommand(cfg: HuaxinConfig, deviceImei: string, command: string): Promise<Envelope> {
  return call("/machine/cloud/api/remote/control/data", cfg, {
    data: { serialNum: String(Date.now()), type: "operate", deviceImei, data: { command, value: "1" } },
  });
}

export async function refreshResource(cfg: HuaxinConfig, deviceImei: string) {
  return sendCommand(cfg, deviceImei, "operate_refresh_resource");
}

export async function getDeviceStatus(cfg: HuaxinConfig, deviceImei: string) {
  const data = await call("/machine/cloud/api/device/configure/status/detail", cfg, { device_imei: deviceImei });
  return (data.data as { code?: string; value?: string; desc?: string }[]) ?? [];
}

export async function listDeviceMedia(cfg: HuaxinConfig, deviceImei: string) {
  const data = await call("/machine/cloud/api/device/configure/videos", cfg, { device_imei: deviceImei });
  const payload = data.data as { videos?: { code?: string; imagePath?: string; duration?: number; intro?: string }[] } | null;
  return payload?.videos ?? [];
}

export async function editDeviceMedia(
  cfg: HuaxinConfig,
  deviceImei: string,
  params: { res_type: string; res_path: string; res_intro?: string; res_code?: string; res_duration?: number },
) {
  return call("/machine/cloud/api/device/configure/videos/edit", cfg, { device_imei: deviceImei, ...params });
}

export async function removeDeviceMedia(cfg: HuaxinConfig, deviceImei: string, res_type: string, res_code: string) {
  return call("/machine/cloud/api/device/configure/videos/remove", cfg, { device_imei: deviceImei, res_type, res_code });
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
