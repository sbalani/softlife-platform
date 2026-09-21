import type { Metadata } from "next";
import Link from "next/link";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { ReportIncidentForm } from "./ReportIncidentForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report a machine issue | SoftLife", robots: { index: false, follow: false } };

export default async function ReportIncidentPage() {
  let machines: { id: string; label: string }[] = [];
  if (isSupabaseConfigured()) {
    const { data } = await (await createServiceClient()).from("machines").select("id,name,display_name").eq("deployed", true).order("display_name").order("name");
    machines = (data ?? []).map((machine) => ({ id: machine.id as string, label: String(machine.display_name || machine.name || "Machine") }));
  }
  return <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_#f5ddd0_0,_transparent_36%),linear-gradient(145deg,#fbf7f3_30%,#edf5ef)] px-4 py-10 sm:py-16"><div className="mx-auto max-w-2xl"><header className="mb-8"><p className="text-xs font-bold uppercase tracking-[0.24em] text-terracotta">SoftLife support</p><h1 className="mt-2 font-display text-4xl font-bold leading-tight text-cocoa sm:text-5xl">Tell us what happened.</h1><p className="mt-3 max-w-xl text-sm leading-6 text-taupe sm:text-base">Choose the label shown on the machine, share how we can reach you, and describe the issue. Evidence goes directly to private storage.</p></header>{machines.length ? <ReportIncidentForm machines={machines} /> : <p className="rounded-2xl border border-warning/30 bg-white p-6 text-sm font-semibold text-warning">Incident reporting is temporarily unavailable. Please contact SoftLife directly.</p>}<p className="mt-6 text-center text-xs text-taupe">Do not include payment card details or other sensitive information. Read our <Link href="/privacy" className="font-semibold text-terracotta underline">privacy policy</Link>.</p></div></main>;
}
