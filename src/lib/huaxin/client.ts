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
  marketPrice?: string | number;
  discountPrice?: string | number;
  rePrice?: string | number;
  nums?: string | number;
  status?: string | number;
  payType?: string;
  payTime?: string;
  localPayTime?: string;
  createTime?: string;
  createTimeUtc?: string;
  productName?: string;
  goodsName?: string;
  refundStatus?: string | number;
  refundOutNo?: string | null;
  coupon?: { result?: boolean; [k: string]: unknown };
  activityName?: string;
  deviceLabel?: string;
  products?: { goodsName?: string; price?: string; position?: number }[];
  deviceImei?: string;
  [k: string]: unknown;
};

export type Envelope = {
  code?: number;
  msg?: string;
  data?: unknown;
  jsessionId?: string;
  result?: boolean;
};

export const COUPON_PATHS = {
  edit: "/machine/cloud/api/coupon/edit",
  list: "/machine/cloud/api/coupon/list",
  generate: "/machine/cloud/api/coupon/generate/records",
  records: "/machine/cloud/api/coupon/records/list",
  delete: "/machine/cloud/api/coupon/del",
} as const;

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

  let res: { ok: boolean; status: number; statusText: string; text(): Promise<string> };
  if (cfg.verifySsl === false) {
    // Use undici's own fetch (not the Next.js-patched global) so the dispatcher
    // — which disables TLS verification for the expired UAT cert — is honoured.
    const undici = await import("undici");
    res = await undici.fetch(url, {
      method: "POST",
      headers: reqHeaders,
      body,
      dispatcher: new undici.Agent({ connect: { rejectUnauthorized: false } }),
    });
  } else {
    res = await fetch(url, { method: "POST", headers: reqHeaders, body });
  }

  const text = await res.text();
  let data: Envelope;
  try {
    data = JSON.parse(text) as Envelope;
  } catch {
    throw new Error(`Huaxin ${path} returned HTTP ${res.status} with a non-JSON response`);
  }
  if (!res.ok) throw new Error(`Huaxin ${path} returned HTTP ${res.status}: ${data.msg ?? res.statusText}`);
  return data;
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
  const payload = data.data as { temperatures?: TempPayload } | null;
  return (payload?.temperatures ?? { category: [], dataset: [] }) as TempPayload;
}

export type TempPayload = {
  category?: { label?: string }[];
  dataset?: { seriesname?: string; data?: { value?: string | number }[] }[];
};

export async function listOrdersPage(
  cfg: HuaxinConfig,
  deviceImei: string,
  began?: string,
  end?: string,
  page = 1,
): Promise<{ records: HuaxinOrder[]; totalPage: number }> {
  const data = await call("/machine/cloud/api/device/orders", cfg, {
    device_imei: deviceImei,
    beganTime: began ?? "",
    endTime: end ?? "",
    page: String(page),
  });
  const payload = data.data;
  if (Array.isArray(payload)) return { records: payload as HuaxinOrder[], totalPage: 1 };
  const obj = payload as { records?: HuaxinOrder[]; list?: HuaxinOrder[]; orders?: HuaxinOrder[]; totalPage?: number } | null;
  return {
    records: obj?.records ?? obj?.list ?? obj?.orders ?? [],
    totalPage: Number(obj?.totalPage ?? 1) || 1,
  };
}

export async function listOrders(
  cfg: HuaxinConfig,
  deviceImei: string,
  began?: string,
  end?: string,
  page = 1,
): Promise<HuaxinOrder[]> {
  return (await listOrdersPage(cfg, deviceImei, began, end, page)).records;
}

/** Walks every page of the orders endpoint — page 1 alone silently truncates
 *  busy periods or long backfill windows. Capped to keep a pathological
 *  totalPage from hammering the API. */
export async function listAllOrders(
  cfg: HuaxinConfig,
  deviceImei: string,
  began?: string,
  end?: string,
  maxPages = 50,
): Promise<HuaxinOrder[]> {
  const first = await listOrdersPage(cfg, deviceImei, began, end, 1);
  if (first.totalPage > maxPages) {
    throw new Error(`Huaxin orders require ${first.totalPage} pages; limit is ${maxPages}`);
  }
  const out = [...first.records];
  for (let p = 2; p <= first.totalPage; p++) {
    const { records } = await listOrdersPage(cfg, deviceImei, began, end, p);
    if (!records.length) break;
    out.push(...records);
  }
  return out;
}

export type ProductDiyItem = {
  position?: string | number;
  goodsName?: string;
  price?: string;
  imagePath?: string;
  enable?: number;
  stock?: string;
  marketPrice?: string;
  languagePacks?: { code?: string; goodsName?: string; intro?: string }[];
  intro?: string;
};

export function localizedGoodsName(item: ProductDiyItem, lang = "es"): string {
  const packs = Array.isArray(item.languagePacks) ? item.languagePacks : [];
  const lp = packs.find((p) => p.code === lang);
  return lp?.goodsName || item.goodsName || "";
}

export function languagePackEntries(item: ProductDiyItem): { code: string; goodsName: string }[] {
  const packs = Array.isArray(item.languagePacks) ? item.languagePacks : [];
  return packs
    .filter((p): p is { code: string; goodsName: string } => !!p.code && !!p.goodsName)
    .map((p) => ({ code: p.code, goodsName: p.goodsName }));
}

export async function listDeviceProducts(cfg: HuaxinConfig, deviceImei: string): Promise<{ diy: ProductDiyItem[]; unify: ProductDiyItem[] }> {
  const data = await call("/machine/cloud/api/device/product", cfg, { device_imei: deviceImei });
  console.log(`[huaxin] listDeviceProducts ${deviceImei}:`, JSON.stringify(data, null, 2));
  const payload = data.data as { diy?: ProductDiyItem[]; unify?: ProductDiyItem[] } | null;
  return {
    diy: payload?.diy ?? [],
    unify: payload?.unify ?? [],
  };
}

export type DiyPushItem = { position: string; code: string; value: string | { language: string; code: string; value: string } };

export async function pushProductDiy(
  cfg: HuaxinConfig,
  deviceImei: string,
  items: DiyPushItem[],
) {
  const body = {
    device_imei: deviceImei,
    data: { serialNum: String(Date.now()), type: "productDiy", deviceImei, data: items },
  };
  console.log("[huaxin] pushProductDiy:", JSON.stringify(body, null, 2));
  const result = await call("/machine/cloud/api/batch/motify/data", cfg, body);
  console.log("[huaxin] pushProductDiy response:", JSON.stringify(result));
  return result;
}

export async function refreshProduct(cfg: HuaxinConfig, deviceImei: string) {
  return sendCommand(cfg, deviceImei, "operate_refresh_product");
}

// ---- Remote control / status / media ----

export async function sendCommand(cfg: HuaxinConfig, deviceImei: string, command: string): Promise<Envelope> {
  return call("/machine/cloud/api/remote/control/data", cfg, {
    device_imei: deviceImei,
    data: { serialNum: String(Date.now()), type: "operate", deviceImei, data: { command, value: "1" } },
  });
}

export async function refreshResource(cfg: HuaxinConfig, deviceImei: string) {
  return sendCommand(cfg, deviceImei, "operate_refresh_resource");
}

export async function getDeviceStatus(cfg: HuaxinConfig, deviceImei: string) {
  const data = await call("/machine/cloud/api/device/configure/status/detail", cfg, { device_imei: deviceImei });
  return (data.data as { code?: string; value?: string; desc?: string; data?: string | number }[]) ?? [];
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

// ---- Device info (branding) / settings ----

export async function updateDeviceInfo(cfg: HuaxinConfig, deviceImei: string, fields: Record<string, string>[]) {
  return call("/machine/cloud/api/batch/motify/data", cfg, {
    device_imei: deviceImei,
    data: { serialNum: String(Date.now()), type: "deviceInfo", deviceImei, data: fields },
  });
}

export async function getDeviceSettings(cfg: HuaxinConfig, deviceImei: string) {
  const data = await call("/machine/cloud/api/device/configure/set/detail", cfg, { device_imei: deviceImei });
  return (data.data as { code?: string; value?: string; desc?: string }[]) ?? [];
}

export async function pushDeviceSetting(cfg: HuaxinConfig, deviceImei: string, code: string, value: string) {
  return call("/machine/cloud/api/remote/control/data", cfg, {
    device_imei: deviceImei,
    data: { serialNum: String(Date.now()), type: "configure", deviceImei, data: { code, value } },
  });
}

// ---- Coupons / promotions ----

export type HuaxinCoupon = {
  couponId?: string | number;
  couponName?: string;
  couponType?: string | number;
  deviceImeis?: string;
  validDay?: string | number;
  startTime?: string;
  endTime?: string;
  content?: string;
  localName?: string;
  createTime?: string;
  updateTime?: string;
  merchantName?: string;
};

export function couponApiError(data: Envelope): string | null {
  const nested = data.data as { result?: boolean; message?: string } | null;
  if (String(data.code) !== "200" || data.result === false || nested?.result === false) {
    return nested?.message ?? data.msg ?? "Huaxin rejected the coupon request.";
  }
  return null;
}

export async function listCouponsPage(cfg: HuaxinConfig, deviceImei: string, page = 1) {
  const data = await call(COUPON_PATHS.list, cfg, { device_imei: deviceImei, page: String(page) });
  const error = couponApiError(data);
  if (error) throw new Error(error);
  if (Array.isArray(data.data)) return { coupons: data.data as HuaxinCoupon[], totalPage: 1 };
  const payload = data.data as { list?: HuaxinCoupon[]; records?: HuaxinCoupon[]; totalPage?: number } | null;
  return { coupons: payload?.list ?? payload?.records ?? [], totalPage: Number(payload?.totalPage ?? 1) || 1 };
}

export async function listCoupons(cfg: HuaxinConfig, deviceImei: string) {
  const first = await listCouponsPage(cfg, deviceImei);
  if (first.totalPage > 20) throw new Error(`Huaxin coupons require ${first.totalPage} pages; limit is 20`);
  const coupons = [...first.coupons];
  for (let page = 2; page <= first.totalPage; page++) {
    const next = await listCouponsPage(cfg, deviceImei, page);
    coupons.push(...next.coupons);
  }
  return coupons;
}

export async function createCoupon(cfg: HuaxinConfig, params: Record<string, string>) {
  return call(COUPON_PATHS.edit, cfg, params);
}

export async function generateCouponCodes(cfg: HuaxinConfig, couponId: string, num: number) {
  return call(COUPON_PATHS.generate, cfg, { couponId, num: String(num) });
}

export async function getCouponRecords(cfg: HuaxinConfig, couponId: string, couponCode = "") {
  const records: unknown[] = [];
  let page = 1;
  let totalPage = 1;
  do {
    const data = await call(COUPON_PATHS.records, cfg, { couponId, couponCode, page: String(page) });
    const error = couponApiError(data);
    if (error) throw new Error(error);
    const payload = data.data as { list?: unknown[]; totalPage?: number } | null;
    records.push(...(payload?.list ?? []));
    totalPage = Math.min(Number(payload?.totalPage ?? 1) || 1, 20);
    page++;
  } while (page <= totalPage);
  return records;
}

export async function deleteCouponApi(cfg: HuaxinConfig, couponIds: string) {
  return call(COUPON_PATHS.delete, cfg, { couponIds });
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
