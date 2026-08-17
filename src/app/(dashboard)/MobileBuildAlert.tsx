"use client";

import Link from "next/link";
import { useState } from "react";

export type MobileBuildAlertData = { id: string; version: string | null; buildNumber: string | null };

export function MobileBuildAlert({ build }: { build: MobileBuildAlertData }) {
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!visible) return null;
  const version = [build.version, build.buildNumber ? `build ${build.buildNumber}` : null].filter(Boolean).join(" · ");
  async function suppress() {
    setBusy(true);
    const response = await fetch(`/api/mobile-builds/${encodeURIComponent(build.id)}/suppress`, { method: "POST" });
    if (response.ok) setVisible(false);
    else setBusy(false);
  }
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-terracotta/30 bg-terracotta/10 px-4 py-3 text-sm text-cocoa">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-terracotta text-lg font-bold text-white">↓</span>
      <div className="min-w-0 flex-1"><strong>New SoftLife app available</strong>{version && <span className="text-taupe"> · {version}</span>}<div className="text-xs text-taupe">Download the latest Android APK to dismiss this update.</div></div>
      <Link href="/downloads" className="rounded-lg bg-cocoa px-3 py-2 text-xs font-bold text-white">View download</Link>
      <button type="button" disabled={busy} onClick={suppress} className="px-2 py-2 text-xs font-semibold text-taupe hover:text-cocoa disabled:opacity-50">Suppress</button>
    </div>
  );
}
