import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  huaxinOrderTime,
  orderRowFromHuaxin,
  previousCalendarDate,
  selectOrderDevices,
  tenantForOrder,
} from "./order.ts";

Deno.test("maps Huaxin orders with offline sale time and historical tenant", () => {
  const order = {
    orderCode: "A1",
    status: 3,
    price: "4.50",
    nums: 2,
    localPayTime: "2026-10-15 12:30:00",
    createTimeUtc: "2026-10-16T09:00:00Z",
    products: [{ goodsName: "Vanilla" }],
  };
  const orderTime = huaxinOrderTime(order);
  const tenant = tenantForOrder(
    [{
      machine_id: "m1",
      tenant_id: "t1",
      start_date: "2026-10-01",
      end_date: null,
    }],
    "m1",
    orderTime,
  );
  const row = orderRowFromHuaxin(order, {
    id: "m1",
    tenantId: tenant,
    imei: "86123456",
  }, "2026-10-16T10:00:00Z");
  assertEquals(row.order_time, "2026-10-15T04:30:00.000Z");
  assertEquals(row.tenant_id, "t1");
  assertEquals(row.product_name, "Vanilla");
  assertEquals(row.price, 4.5);
  assertEquals(row.nums, 2);
});

Deno.test("calendar and device selection helpers are deterministic", () => {
  assertEquals(previousCalendarDate("2026-03-30"), "2026-03-29");
  assertEquals(
    selectOrderDevices([{ deviceImei: "1" }, { deviceImei: "2" }], ["2", "3"]),
    {
      devices: [{ deviceImei: "2" }],
      missing: ["3"],
    },
  );
});
