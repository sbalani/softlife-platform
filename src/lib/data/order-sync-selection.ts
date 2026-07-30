export function selectOrderDevices<T extends { deviceImei?: string }>(devices: T[], selectedImeis: string[]) {
  const selected = new Set(selectedImeis);
  if (!selected.size) return { devices, missing: [] };
  const matching = devices.filter((device) => device.deviceImei && selected.has(device.deviceImei));
  const found = new Set(matching.map((device) => device.deviceImei));
  return { devices: matching, missing: selectedImeis.filter((imei) => !found.has(imei)) };
}
