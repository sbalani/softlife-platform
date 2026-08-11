export const HUAXIN_REMOTE_COMMANDS = [
  { command: "operate_backorigin", label: "Return home", note: "Returns the mechanism to its home position", icon: "↩", access: "admin" },
  { command: "operate_openrefrigeration", label: "Fridge on", note: "Starts refrigeration", icon: "❄", access: "remote" },
  { command: "operate_closerefrigeration", label: "Fridge off", note: "Stops refrigeration", icon: "🔥", access: "remote" },
  { command: "operate_openthawing", label: "Defrost on", note: "Starts defrosting", icon: "💧", access: "remote" },
  { command: "operate_closethawing", label: "Defrost off", note: "Stops defrosting", icon: "⏹", access: "remote" },
  { command: "operate_sellout", label: "Sold out", note: "Stops customer sales", icon: "⏸", access: "remote" },
  { command: "operate_onsale", label: "Resume sales", note: "Makes the machine available", icon: "▶", access: "remote" },
  { command: "operate_make", label: "Test cup", note: "Dispenses one free cup", icon: "🍦", access: "remote" },
  { command: "operate_android_setting", label: "Android settings", note: "Opens the Android system settings", icon: "⚙", access: "admin" },
  { command: "operate_config_set1", label: "Device settings 1", note: "Opens device parameter screen 1", icon: "⚙", access: "admin" },
  { command: "operate_config_set2", label: "Device settings 2", note: "Opens device parameter screen 2", icon: "⚙", access: "admin" },
  { command: "operate_status", label: "Status query", note: "Requests the current device status", icon: "📡", access: "admin" },
  { command: "operate_refresh_product", label: "Sync products", note: "Refreshes product information on the machine", icon: "↻", access: "admin" },
  { command: "operate_refresh_resource", label: "Sync media", note: "Refreshes media on the machine", icon: "↻", access: "admin" },
  { command: "operate_switch_two", label: "Second cup half price", note: "Toggles the second-cup half-price promotion", icon: "%", access: "admin" },
  { command: "operate_switch_three", label: "Buy 3, get 1", note: "Toggles the buy-three-get-one promotion", icon: "%", access: "admin" },
  { command: "operate_switch_coupon", label: "Toggle theme", note: "Toggles the machine theme", icon: "◐", access: "admin" },
  { command: "operate_switch_theme", label: "Toggle coupons", note: "Toggles coupons on the machine", icon: "%", access: "admin" },
  { command: "operate_clearwarn", label: "Clear alarm", note: "Clears the current machine alarm", icon: "🔔", access: "admin" },
] as const;

export const FRANCHISEE_REMOTE_COMMANDS = HUAXIN_REMOTE_COMMANDS.filter((item) => item.access === "remote");
