/** Translation table for Chinese terms returned by the Huaxin API.
 *  Add entries here as we encounter new Chinese values in production. */

// ---- Pay types (order.payType) ----

export type PaymentMethodCode = "admin_override" | "wechat_pay" | "alipay" | "card" | "cash" | "coin" | "qr_payment" | "coupon" | "free" | "other";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodCode, string> = {
  admin_override: "Admin override",
  wechat_pay: "WeChat Pay",
  alipay: "Alipay",
  card: "Card",
  cash: "Cash",
  coin: "Coin",
  qr_payment: "QR payment",
  coupon: "Coupon",
  free: "Free",
  other: "Other",
};

const PAYMENT_METHOD_ALIASES: Record<string, PaymentMethodCode> = {
  "自动制作": "admin_override", "admin override": "admin_override",
  "微信支付": "wechat_pay", "wechat pay": "wechat_pay", "wechat": "wechat_pay",
  "支付宝": "alipay", "alipay": "alipay",
  "刷卡": "card", "刷卡支付": "card", "card": "card", "card payment": "card",
  "现金": "cash", "现金支付": "cash", "cash": "cash", "cash payment": "cash",
  "投币": "coin", "coin": "coin",
  "扫码支付": "qr_payment", "qr payment": "qr_payment", "qr code payment": "qr_payment",
  "串码支付": "coupon", "coupon": "coupon",
  "免费": "free", "free": "free",
};

export function paymentMethodCode(raw: string | null): PaymentMethodCode | null {
  const normalized = raw?.trim().toLowerCase();
  return normalized ? PAYMENT_METHOD_ALIASES[normalized] ?? "other" : null;
}

export function translatePayType(raw: string | null): string | null {
  const code = paymentMethodCode(raw);
  return code ? PAYMENT_METHOD_LABELS[code] : null;
}

// ---- Admin override / server mode detection ----

export function isAdminOverride(payType: string | null): boolean {
  return paymentMethodCode(payType) === "admin_override";
}

export function isServerModeOrder(_payType: string | null): boolean {
  // TODO: add the actual payType string once Huaxin defines the franchisee-card payment type.
  void _payType;
  return false;
}

// ---- Device status descriptions (device/configure/status/detail .desc) ----

export const STATUS_DESC_MAP: Record<string, string> = {
  "MAC编码": "MAC Address",
  "端口号": "Port",
  "售卖开始时间": "Sales Start",
  "售卖结束时间": "Sales End",
  "电机运行周期": "Motor Cycle",
  "电机运行比例[%]": "Motor Ratio [%]",
  "电机运行最长时间[ms]": "Motor Max Time [ms]",
  // Live status fields (from the actual machine response)
  "Status Code": "Status Code",
  "Sales Mode": "Sales Mode",
  "Screen Time": "Screen Time",
  "Mainboard Time": "Mainboard Time",
  "Sales Start": "Sales Start",
  "Sales End": "Sales End",
  "Refrigeration": "Refrigeration",
  "Defrost": "Defrost",
  "Freshness": "Freshness",
  "Cleaning": "Cleaning",
  "Sterilizing": "Sterilizing",
  "Maintenance": "Maintenance",
  "Hardness": "Hardness",
  "Formation Ratio": "Formation Ratio",
  "Voltage": "Voltage",
  "Compressor Temperature": "Compressor Temp",
  "Cylinder Temperature": "Cylinder Temp",
  "Hopper Temperature": "Hopper Temp",
  "Ambient Temperature": "Ambient Temp",
  "Condenser Temperature": "Condenser Temp",
  "Evaporator Temperature": "Evaporator Temp",
  "Fan Status": "Fan Status",
  "Door Status": "Door Status",
  "Belt Status": "Belt Status",
  "Material Level": "Material Level",
  "Water Level": "Water Level",
  "Power Status": "Power Status",
  "Error Code": "Error Code",
  "Warning": "Warning",
  "Stock": "Stock",
  "Position": "Position",
  "Product Name": "Product Name",
  "Price": "Price",
  "Market Price": "Market Price",
  "Enable": "Enable",
  "Image": "Image",
  "Language": "Language",
  "Online Status": "Online Status",
  "Device Label": "Device Label",
  "Device Merchant": "Merchant",
  "Device Tel": "Phone",
  "App Version": "App Version",
  "Device Version": "Device Version",
  "Cur Version": "Current Version",
  "Last Report Time": "Last Report",
  "Update Time": "Last Updated",
  "Device Valid Time": "Valid Until",
  "Device Activity Switch": "Activity Switch",
  "Device Coin Tag": "Coin Tag",
  "Device SKU": "SKU",
  "Device Icon": "Icon",
  "Device Location": "Location",
  "Device Coordinate": "Coordinates",
  "status_0_cuplack": "Cup Shortage Status",
  "status_0_lackmaterial": "Material Shortage Status",
  "status_0_online_status": "App Online Status",
  "status_0_os": "Ordering System",
  "status_0_sellcup": "Cups Remaining After Material Shortage",
  "status_0_faultcup": "Foreign Object in Cup Holder",
  "status_0_cupfault": "Cup Dispenser Blocked",
  "status_0_cupget": "Cup Pickup Status",
  "Cup Shortage Status": "Cup Shortage Status",
  "Material Shortage Status": "Material Shortage Status",
  "app online status": "App Online Status",
  "Limpieza": "Cleaning",
  "Cuerpos extraños": "Foreign Object in Cup Holder",
  "Falta de Tarrina": "Cup Shortage Status",
  "Falta de material": "Material Shortage Status",
  "Número de tazas vendidas": "Cups Remaining After Material Shortage",
  "Temperatura medida": "Measured Temperature",
};

export function translateStatusDesc(raw: string | null | undefined): string {
  if (!raw) return "—";
  // Try exact match first
  if (STATUS_DESC_MAP[raw]) return STATUS_DESC_MAP[raw];
  // Try case-insensitive match for English descriptions already returned
  const lower = raw.toLowerCase();
  for (const [key, val] of Object.entries(STATUS_DESC_MAP)) {
    if (key.toLowerCase() === lower) return val;
  }
  // If it contains Chinese characters, show raw (we haven't mapped it yet)
  return raw;
}

// ---- Status values (device/configure/status/detail .value) ----

export const STATUS_VALUE_MAP: Record<string, Record<string, string>> = {
  "Normal": { "异常": "Abnormal", "正常": "Normal", "On": "On", "Off": "Off", "True": "Yes", "False": "No" },
  // Generic value translations
};

export function translateStatusValue(value: string | null | undefined): string {
  if (!value) return "—";
  const operatingState = value.match(/^\[(\d+)]/)?.[1];
  const operatingStates: Record<string, string> = {
    "4": "Remote control (defrost or service mode)",
    "8": "Insufficient stock",
    "9": "Closed",
    "11": "Night mode",
    "101": "Cup shortage",
    "102": "Material exhausted",
    "104": "Cup not taken",
    "105": "Refrigeration off",
    "120": "Foreign object in cup holder",
    "255": "Insufficient proportion",
  };
  if (operatingState && operatingStates[operatingState]) return operatingStates[operatingState];
  // Common Chinese→English for status values
  const common: Record<string, string> = {
    "正常": "Normal",
    "异常": "Abnormal",
    "开": "On",
    "关": "Off",
    "是": "Yes",
    "否": "No",
    "无": "None",
    "待机": "Standby",
    "运行": "Running",
    "故障": "Fault",
    "制冷": "Cooling",
    "化霜": "Defrosting",
    "清洗": "Cleaning",
    "消毒": "Sterilizing",
    "保养": "Maintenance",
    "保鲜": "Freshness",
    "Comienza a faltar material": "Material running low",
    "Starts lacking material": "Material running low",
    "Liquid level low": "Liquid level low",
    "normal": "Normal",
    "online": "Online",
    "offline": "Offline",
    "Cierre": "Off",
    "Close": "Off",
    "Open": "On",
  };
  const cups = value.match(/^Normal\[(\d+)]$/i);
  return cups ? cups[1] : common[value] ?? value;
}

// ---- Detected device locations (device list .deviceLocation) ----
// Huaxin reports addresses as a Chinese region prefix glued to a Latin street
// address, e.g. "安达卢西亚马拉加Calle Obispo Salvador de los Reyes9".
// Translate known place-name prefixes and reorder to street-first.

export const LOCATION_PLACE_MAP: Record<string, string> = {
  "西班牙": "Spain",
  "安达卢西亚": "Andalucía",
  "马拉加": "Málaga",
  "马德里": "Madrid",
  "巴塞罗那": "Barcelona",
  "塞维利亚": "Sevilla",
  "格拉纳达": "Granada",
  "科尔多瓦": "Córdoba",
  "加的斯": "Cádiz",
  "瓦伦西亚": "Valencia",
};

export function translateLocation(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Split leading CJK prefix from the Latin remainder.
  const m = raw.match(/^([一-鿿]+)(.*)$/);
  if (!m) return raw;
  let [, cjk, rest] = m;
  const places: string[] = [];
  while (cjk.length) {
    const hit = Object.keys(LOCATION_PLACE_MAP)
      .filter((k) => cjk.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!hit) break;
    places.push(LOCATION_PLACE_MAP[hit]);
    cjk = cjk.slice(hit.length);
  }
  if (cjk.length) places.push(cjk); // untranslated leftover, keep visible
  rest = rest.trim().replace(/(\D)(\d+)$/, "$1 $2"); // "Reyes9" -> "Reyes 9"
  if (!rest) return places.join(", ") || raw;
  // Street first, then region (most-specific place last-but-first order reversed).
  return [rest, ...places.reverse()].join(", ");
}
