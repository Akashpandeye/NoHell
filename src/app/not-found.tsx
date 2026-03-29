import Link from "next/link";

import { AimMark } from "@/components/brand/AimMark";

export default function NotFound() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-nh-bg px-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_58%,var(--nh-teal-glow),transparent_72%)]"
      />
      <div className="relative z-10 flex max-w-md flex-col items-center text-center">
        <Link
          href="/"
          className="mb-8 flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg"
        >
          <AimMark className="h-8 w-8 text-nh-cta" />
          <span className="font-display text-xl font-extrabold tracking-[-0.03em] text-nh-text">
            NoHell
          </span>
        </Link>
        <p className="font-display text-sm font-bold uppercase tracking-[0.35em] text-nh-teal">
          404
        </p>
        <h1 className="mt-3 font-display text-2xl font-extrabold tracking-[-0.04em] text-nh-text sm:text-3xl">
          Page not found
        </h1>
        <p className="mt-3 font-mono text-sm text-nh-muted">
          That URL does not exist. Head back and keep learning.
        </p>
        <Link
          href="/"
          className="font-display mt-8 inline-flex rounded-xl bg-nh-cta px-6 py-3 text-sm font-bold text-neutral-950 transition-colors hover:bg-nh-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-cta focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
