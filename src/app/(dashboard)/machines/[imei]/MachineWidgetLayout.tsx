"use client";

import { Children, isValidElement, type ReactNode } from "react";
import type { MachineDetailWidgetId } from "@/lib/machine-detail-layout";

function widgetId(node: ReactNode) {
  if (!isValidElement<{ "data-machine-widget"?: unknown }>(node)) return null;
  const id = node.props["data-machine-widget"];
  return typeof id === "string" ? id : null;
}

export function MachineWidgetLayout({ order, children }: { order: MachineDetailWidgetId[]; children: ReactNode }) {
  const position = new Map(order.map((id, index) => [id, index]));
  const widgets = Children.toArray(children).sort((left, right) =>
    (position.get(widgetId(left) as MachineDetailWidgetId) ?? order.length)
    - (position.get(widgetId(right) as MachineDetailWidgetId) ?? order.length));
  return <div className="flex flex-col">{widgets}</div>;
}
