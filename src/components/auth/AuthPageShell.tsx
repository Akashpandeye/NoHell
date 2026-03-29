import Link from "next/link";

import { AimMark } from "@/components/brand/AimMark";

type AuthPageShellProps = {
  title: string;
  subtitle: string;
  alternateHref: string;
  alternateLabel: string;
  children: React.ReactNode;
};

export function AuthPageShell({
  title,
  subtitle,
  alternateHref,
  alternateLabel,
  children,
}: AuthPageShellProps) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-nh-bg">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_52%_42%_at_50%_42%,var(--nh-teal-glow),transparent_72%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[min(92vw,44rem)] -translate-x-1/2 rounded-full bg-nh-teal/[0.06] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 h-64 w-64 translate-x-1/4 translate-y-1/4 rounded-full bg-nh-cta/[0.04] blur-3xl"
      />

      <header className="relative z-10 border-b border-nh-border/50 bg-nh-bg/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="group flex cursor-pointer items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg"
          >
            <AimMark className="h-8 w-8 shrink-0 text-nh-cta transition-transform duration-300 group-hover:scale-105" />
            <span className="font-display text-lg font-extrabold tracking-[-0.03em] text-nh-text transition-colors group-hover:text-nh-teal">
              NoHell
            </span>
          </Link>
          <Link
            href={alternateHref}
            className="font-display cursor-pointer text-sm font-semibold text-nh-muted transition-colors duration-200 hover:text-nh-teal"
          >
            {alternateLabel}
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex min-h-[calc(100dvh-4.5rem)] flex-col items-center justify-center px-4 py-10 sm:min-h-[calc(100vh-4.5rem)] sm:py-14">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 text-center">
            <h1 className="font-display text-[1.75rem] font-extrabold leading-tight tracking-[-0.04em] text-nh-text sm:text-3xl">
              {title}
            </h1>
            <p className="mx-auto mt-2 max-w-sm font-mono text-xs leading-relaxed text-[#c9aa8c] sm:text-[13px]">
              {subtitle}
            </p>
          </div>

          <div className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-[1px] rounded-2xl bg-gradient-to-b from-nh-teal/25 via-transparent to-nh-cta/15 opacity-40 blur-sm"
            />
            <div className="relative rounded-2xl border border-nh-border/90 bg-nh-surface/70 p-6 shadow-[0_28px_90px_-36px_rgba(0,0,0,0.9)] backdrop-blur-xl sm:p-8">
              <div
                aria-hidden
                className="absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-nh-teal/50 to-transparent sm:inset-x-12"
              />
              <div className="relative pt-1">{children}</div>
            </div>
          </div>

          <p className="mt-8 text-center">
            <Link
              href="/"
              className="font-mono text-xs text-nh-dim transition-colors duration-200 hover:text-nh-teal"
            >
              ← Back to home
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
