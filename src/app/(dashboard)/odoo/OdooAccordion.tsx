import type { ReactNode } from "react";

export function OdooAccordion({
  title, description, badge, children, defaultOpen = true, className = "mb-8",
}: {
  title: string;
  description?: string;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return <section className={`${className} rounded-2xl border border-line bg-white`}>
    <details open={defaultOpen} className="group/section">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-5 marker:content-none">
        <div>
          <h2 className="font-display text-xl font-bold text-cocoa">{title}</h2>
          {description && <p className="mt-1 max-w-3xl text-xs text-taupe">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          <span aria-hidden="true" className="inline-flex size-7 items-center justify-center rounded-full border border-line text-xs font-bold text-cocoa transition-transform group-open/section:rotate-180">v</span>
        </div>
      </summary>
      <div className="border-t border-line p-5">{children}</div>
    </details>
  </section>;
}
