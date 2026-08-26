import type { Metadata } from "next";
import Link from "next/link";
import { FranchiseeSignupForm } from "./FranchiseeSignupForm";

export const metadata: Metadata = {
  title: "Request franchisee access | SoftLife",
  description: "Request access to the SoftLife franchisee platform.",
};

export default function FranchiseeSignupPage() {
  return (
    <main className="min-h-screen bg-cream px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-6 text-center">
          <div className="text-xs font-bold uppercase tracking-[0.28em] text-terracotta">SoftLife</div>
          <h1 className="mt-3 font-display text-3xl font-bold text-cocoa sm:text-4xl">Request franchisee access</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-taupe">Submit your details. Our team will verify your relationship and assign access without publishing our franchisee directory.</p>
        </div>
        <section className="rounded-3xl border border-line bg-white p-6 shadow-[0_18px_60px_rgba(59,44,32,0.08)] sm:p-8"><FranchiseeSignupForm /></section>
        <p className="mt-5 text-center text-xs text-taupe">Already have an account? <Link href="/login" className="font-bold text-terracotta hover:underline">Sign in</Link></p>
      </div>
    </main>
  );
}
