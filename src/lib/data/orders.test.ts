import assert from "node:assert/strict";
import test from "node:test";
import { storedOrderFromRow } from "./order-persistence.ts";
import { paymentMethodCode, translatePayType } from "../i18n/huaxin.ts";

test("rich cached orders retain live-order reporting semantics", () => {
  const order = storedOrderFromRow({
    id: "id",
    order_time: "2026-07-21T18:54:15Z",
    order_code: "order",
    out_trade_no: "payment",
    order_state: "3",
    status_code: "3",
    price: "4.20",
    market_price: "4.60",
    discount_price: "0.40",
    re_price: "0",
    product_name: "Oreo",
    products: [{ goodsName: "Oreo", price: "0.4", position: 2 }],
    nums: "2",
    amount: "2",
    pay_type_raw: "自动制作",
    refund_status: "1",
    refund_out_no: "refund",
    coupon_used: true,
    activity_name: "Promotion",
    device_label: "Machine",
  });
  assert.equal(order.order_state, "COMPLETE");
  assert.equal(order.market_price, 4.6);
  assert.equal(order.products[0].goodsName, "Oreo");
  assert.equal(order.nums, 2);
  assert.equal(order.is_admin_override, true);
  assert.equal(order.machine_collected, 0);
  assert.equal(order.refund_status, "Refunded");
  assert.equal(order.coupon_used, true);
});

test("Huaxin payment methods use stable English terminology", () => {
  for (const [raw, code, label] of [
    ["刷卡支付", "card", "Card"], [" 刷卡 ", "card", "Card"], ["现金", "cash", "Cash"],
    ["现金支付", "cash", "Cash"], ["Cash payment", "cash", "Cash"], ["串码支付", "coupon", "Coupon"],
    ["未知方式", "other", "Other"],
  ] as const) {
    assert.equal(paymentMethodCode(raw), code);
    assert.equal(translatePayType(raw), label);
  }
});

test("stored orders preserve raw payment evidence and expose a canonical method", () => {
  const order = storedOrderFromRow({ id: "id", order_state: "3", status_code: "3", price: 4, pay_type_raw: "刷卡支付" });
  assert.equal(order.pay_type_raw, "刷卡支付");
  assert.equal(order.pay_type_code, "card");
  assert.equal(order.pay_type, "Card");
});
