import {
  getConfigFromEnv,
  getDeviceSettings,
  getDeviceStatus,
  listDevices,
  listDeviceMedia,
  listDeviceProducts,
  listOrders,
  pullTemperatures,
} from "@/lib/huaxin/client";

export type DetailTemp = { time: string; value: number };
export type DetailOrder = {
  order_time: string;
  order_code: string;
  order_state: string;
  price: number;
  product_name: string;
};
export type MachineDetail = {
  name: string;
  device_imei: string;
  device_id: string | null;
  location: string | null;
  online: boolean;
  last_report: string | null;
  temperatures: DetailTemp[];
  orders: DetailOrder[];
};

const STATE: Record<string, string> = {
  "0": "PENDING",
  "1": "PAID",
  "2": "MAKING",
  "3": "COMPLETE",
};

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function toIso(s?: string): string | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function getMachineDetail(imei: string): Promise<MachineDetail | null> {
  const cfg = getConfigFromEnv();
  if (!cfg) return null;

  const devices = await listDevices(cfg);
  const d = devices.find((x) => x.deviceImei === imei);
  if (!d) return null;

  const began = ymd(new Date(Date.now() - 7 * 86_400_000)) + " 00:00:00";
  const end = ymd(new Date()) + " 23:59:59";
  // Huaxin's temperature endpoint returns empty for long windows — the
  // /temperatures page always worked because it asks for 24h. Same here.
  const tempBegan = ymd(new Date(Date.now() - 86_400_000)) + " 00:00:00";

  let temperatures: DetailTemp[] = [];
  try {
    const t = await pullTemperatures(cfg, imei, tempBegan, end);
    const category = t.category ?? [];
    const series = (t.dataset ?? [])[0];
    temperatures = (series?.data ?? []).map((p, i) => ({
      time: category[i]?.label ?? String(i),
      value: Number(p.value ?? 0),
    })).slice(-24);
  } catch {
    /* non-fatal */
  }

  let orders: DetailOrder[] = [];
  try {
    const ords = await listOrders(cfg, imei, began, end);
    orders = ords.map((o) => ({
      order_time: toIso(o.createTime) ?? new Date().toISOString(),
      order_code: o.orderCode ?? "",
      order_state: STATE[String(o.status)] ?? String(o.status ?? ""),
      price: Number(o.price ?? 0),
      product_name: o.products?.[0]?.goodsName ?? o.goodsName ?? "",
    }));
  } catch {
    /* non-fatal */
  }

  return {
    name: (d.deviceLabel as string) || d.deviceName || imei,
    device_imei: imei,
    device_id: d.deviceId ?? null,
    location: (d.deviceLocation as string) ?? null,
    online: (d.onlineStatus as string) === "online",
    last_report: (d.lastReportTime as string) ?? null,
    temperatures,
    orders,
  };
}

export async function getMachineMenu(imei: string) {
  const cfg = getConfigFromEnv();
  if (!cfg) return { diy: [], unify: [] };
  try {
    return await listDeviceProducts(cfg, imei);
  } catch {
    return { diy: [], unify: [] };
  }
}

export async function getMachineStatus(imei: string) {
  const cfg = getConfigFromEnv();
  if (!cfg) return [];
  try {
    return await getDeviceStatus(cfg, imei);
  } catch {
    return [];
  }
}

export async function getMachineMedia(imei: string) {
  const cfg = getConfigFromEnv();
  if (!cfg) return [];
  try {
    return await listDeviceMedia(cfg, imei);
  } catch {
    return [];
  }
}

export async function getMachineSettings(imei: string) {
  const cfg = getConfigFromEnv();
  if (!cfg) return [];
  try {
    return await getDeviceSettings(cfg, imei);
  } catch {
    return [];
  }
}
