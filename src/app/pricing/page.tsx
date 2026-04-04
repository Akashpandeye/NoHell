"use client";

import { AuthNav } from "@/components/auth/AuthNav";
import { AimMark } from "@/components/brand/AimMark";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { PRO_PRICE_USD } from "@/lib/pricing";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export default function PricingPage() {
  const { user } = useUser();
  const router = useRouter();
  const [plan, setPlan] = useState<"free" | "pro" | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/usage");
        if (!res.ok) {
          if (!cancelled) setPlan("free");
          return;
        }
        const u = (await res.json()) as { plan?: string };
        if (!cancelled) setPlan(u.plan === "pro" ? "pro" : "free");
      } catch {
        if (!cancelled) setPlan("free");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const onUpgrade = useCallback(async () => {
    if (!user?.id) return;
    setCheckoutBusy(true);
    setToast(null);
    try {
      await openRazorpayCheckout({
        userId: user.id,
        email: user.primaryEmailAddress?.emailAddress,
        onSuccess: () => {
          setPlan("pro");
          setToast("You're now on Pro!");
          router.refresh();
        },
        onFailure: (msg) => setToast(msg),
      });
    } finally {
      setCheckoutBusy(false);
    }
  }, [user, router]);

  const isPro = plan === "pro";

  return (
    <div className="relative min-h-screen overflow-hidden bg-nh-bg text-nh-text">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_58%,var(--nh-teal-glow),transparent_72%)]"
      />

      <header className="relative z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 pb-1 pt-6 sm:px-6 sm:pt-8 lg:px-8">
          <Link
            href="/"
            className="group flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/50"
          >
            <AimMark className="h-7 w-7 text-nh-cta sm:h-8 sm:w-8" />
            <span className="font-display text-xl font-extrabold text-nh-text sm:text-2xl">
              NoHell
            </span>
          </Link>
          <nav className="flex items-center gap-4">
            <AuthNav />
          </nav>
        </div>
        <div
          aria-hidden
          className="mx-auto mt-4 h-px max-w-6xl bg-gradient-to-r from-transparent via-nh-border to-transparent"
        />
      </header>

      <main className="relative z-10 mx-auto flex max-w-lg flex-col items-center px-4 py-14 sm:px-6 lg:px-8">
        <h1 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Choose your path
        </h1>
        <p className="mt-2 text-center text-sm text-nh-muted">
          You&apos;re all set. Start with free trial or unlock Pro now.
        </p>

        {toast ? (
          <p className="mt-6 w-full rounded-2xl border border-nh-teal/40 bg-nh-surface-2 px-4 py-2 text-center text-sm text-nh-teal">
            {toast}
          </p>
        ) : null}

        <section className="mt-10 w-full rounded-2xl border-2 border-nh-cta/60 bg-nh-surface-2 p-8 shadow-[0_0_60px_rgba(249,115,22,0.06)]">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.25em] text-nh-cta">
            Recommended
          </p>
          <h2 className="font-display text-2xl font-bold text-nh-text">
            Pro plan
          </h2>
          <p className="mt-3 font-mono text-4xl font-semibold text-nh-text">
            ${PRO_PRICE_USD}
            <span className="text-base font-normal text-nh-muted">
              {" "}/ month
            </span>
          </p>
          <p className="mt-4 text-sm leading-relaxed text-nh-muted">
            Everything you need to actually retain what you learn.
          </p>

          <ul className="mt-6 space-y-3 text-sm text-nh-text">
            {[
              "Unlimited learning sessions",
              "Full AI-generated notes",
              "Hourly revision cards",
              "Session recall questions",
              "Notes export (Markdown)",
              "Priority support",
            ].map((f) => (
              <li key={f} className="flex items-start gap-3">
                <span className="mt-0.5 text-nh-cta" aria-hidden>
                  ◆
                </span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          {user ? (
            <button
              type="button"
              disabled={checkoutBusy || isPro}
              className="mt-8 w-full rounded-xl bg-nh-cta py-3.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-nh-cta-hover disabled:opacity-50"
              onClick={() => void onUpgrade()}
            >
              {isPro
                ? "You're already on Pro"
                : checkoutBusy
                  ? "Opening…"
                  : "Buy Pro plan"}
            </button>
          ) : (
            <Link
              href="/sign-up"
              className="mt-8 inline-block w-full rounded-xl bg-nh-cta py-3.5 text-center text-sm font-bold text-neutral-950 transition-colors hover:bg-nh-cta-hover"
            >
              Sign up to buy Pro
            </Link>
          )}
        </section>

        <Link
          href="/"
          className="mt-5 w-full rounded-2xl border border-nh-border bg-nh-surface px-6 py-4 text-center text-sm text-nh-muted transition-colors hover:border-nh-teal/40 hover:text-nh-text"
        >
          Continue with free trial
          <span className="ml-1.5 text-nh-dim">— 5 sessions / month</span>
        </Link>
      </main>
    </div>
  );
}
