import { redirect } from "next/navigation";
import { getSessionProfile } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import type { MobileApkBuild } from "@/lib/mobile-builds";

export const dynamic = "force-dynamic";

function formatBytes(value: number) {
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DownloadsPage() {
  const session = await getSessionProfile();
  if (!session) redirect("/login?next=/downloads");
  const s = await createServiceClient();
  const { data, error } = await s.from("mobile_apk_builds").select("id,version,build_number,release_notes,object_path,byte_size,sha256,published_at")
    .order("published_at", { ascending: false }).order("id", { ascending: false }).limit(5);
  const builds = (data as MobileApkBuild[]) ?? [];

  return (
    <div>
      <header className="mb-6"><p className="text-xs font-bold uppercase tracking-[0.18em] text-terracotta">Android distribution</p><h1 className="mt-1 font-display text-3xl font-bold text-cocoa">SoftLife mobile app</h1><p className="mt-2 max-w-2xl text-sm text-taupe">Download the latest approved APK directly to your Android device. Up to five recent versions are retained.</p></header>
      {error && <div className="rounded-2xl border border-danger/30 bg-danger/5 p-5 text-sm text-danger">Could not load mobile builds: {error.message}</div>}
      {!error && !builds.length && <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center"><h2 className="font-display text-xl font-bold text-cocoa">No APK is available yet</h2><p className="mt-2 text-sm text-taupe">The next published Expo build will appear here automatically.</p></div>}
      <div className="space-y-4">
        {builds.map((build, index) => {
          const label = build.version || `Build published ${new Date(build.published_at).toLocaleDateString("en-GB")}`;
          return <article key={build.id} className={`rounded-2xl border bg-white p-5 ${index === 0 ? "border-terracotta shadow-sm" : "border-line"}`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-xl font-bold text-cocoa">{label}</h2>{build.build_number && <span className="rounded-full bg-cream px-2 py-1 text-[10px] font-bold uppercase text-taupe">Build {build.build_number}</span>}{index === 0 && <span className="rounded-full bg-terracotta px-2 py-1 text-[10px] font-bold uppercase text-white">Latest</span>}</div><p className="mt-1 text-xs text-taupe">Published {new Date(build.published_at).toLocaleString("en-GB")} · {formatBytes(build.byte_size)}</p>{build.release_notes && <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm text-cocoa">{build.release_notes}</p>}<p className="mt-3 font-mono text-[10px] text-taupe">SHA-256 {build.sha256}</p></div>
              <a href={`/downloads/${build.id}`} className="rounded-xl bg-cocoa px-4 py-2.5 text-sm font-bold text-white hover:bg-cocoa/90">Download APK</a>
            </div>
          </article>;
        })}
      </div>
      <div className="mt-6 rounded-2xl bg-sand/70 p-4 text-xs leading-relaxed text-taupe"><strong className="text-cocoa">Android installation:</strong> your device may ask permission to install apps from this browser. Verify that the SHA-256 value is shown before installing updates distributed outside Google Play.</div>
    </div>
  );
}
