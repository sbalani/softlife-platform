import Link from "next/link";
import type { ReactNode } from "react";

const NAV: { label: string; href?: string; soon?: boolean; icon: ReactNode }[] = [
  {
    label: "Machines",
    href: "/machines",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h8M9 16h6" />
      </svg>
    ),
  },
  { label: "Orders", href: "/orders", icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6h15l-1.5 9h-12z" /><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /></svg> },
  { label: "Alerts", href: "/alerts", icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l9 16H3z" /><path d="M12 10v4" /></svg> },
  { label: "Temperatures", href: "/temperatures", icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 14V5a2 2 0 10-4 0v9a4 4 0 104 0z" /></svg> },
  { label: "Inventory", soon: true, icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /></svg> },
  { label: "Transfers", soon: true, icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9h13M14 5l4 4-4 4M21 15H8M10 19l-4-4 4-4" /></svg> },
  { label: "Franchisees", soon: true, icon: <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0114 0" /></svg> },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-sand/60 md:flex">
        <div className="flex items-center gap-3 px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-terracotta text-white font-display text-xl font-bold">
            S
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-bold text-cocoa">SoftLife</div>
            <div className="text-[11px] uppercase tracking-wider text-taupe">Platform</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {NAV.map((item) =>
            item.href ? (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-cocoa transition hover:bg-cream"
              >
                <span className="text-terracotta">{item.icon}</span>
                {item.label}
              </Link>
            ) : (
              <div
                key={item.label}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-taupe/70"
              >
                <span>{item.icon}</span>
                {item.label}
                <span className="ml-auto rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold uppercase text-taupe">
                  soon
                </span>
              </div>
            ),
          )}
        </nav>

        <div className="border-t border-line px-6 py-4 text-xs text-taupe">
          SoftLife Platform · v0.2
        </div>
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
