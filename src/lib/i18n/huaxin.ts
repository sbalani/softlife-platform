/** Translation table for Chinese terms returned by the Huaxin API.
 *  Add entries here as we encounter new Chinese values in production. */

// ---- Pay types (order.payType) ----

export const PAY_TYPE_MAP: Record<string, string> = {
  "自动制作": "Admin override",
  "微信支付": "WeChat Pay",
  "支付宝": "Alipay",
  "刷卡": "Card",
  "现金": "Cash",
  "投币": "Coin",
  "扫码支付": "QR Payment",
  "免费": "Free",
};

export function translatePayType(raw: string | null): string | null {
  if (!raw) return null;
  return PAY_TYPE_MAP[raw] ?? raw;
}

// ---- Admin override / server mode detection ----

export function isAdminOverride(payType: string | null): boolean {
  return payType === "自动制作" || payType === "Admin override";
}

export function isServerModeOrder(payType: string | null): boolean {
  // TODO: add the actual payType string once Huaxin defines the franchisee-card payment type.
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
  };
  return common[value] ?? value;
}
