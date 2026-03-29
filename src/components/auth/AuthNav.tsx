"use client";

import { Show, UserButton } from "@clerk/nextjs";
import Link from "next/link";

import { clerkAppearance } from "@/lib/clerk-appearance";

export function AuthNav() {
  return (
    <nav
      className="flex flex-shrink-0 items-center gap-2 sm:gap-3"
      aria-label="Account"
    >
      <Show when="signed-out">
        <Link
          href="/sign-up"
          className="font-display cursor-pointer rounded-xl bg-nh-cta px-3.5 py-2 text-xs font-bold text-neutral-950 transition-colors duration-200 hover:bg-nh-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-cta focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg sm:px-4 sm:text-sm"
        >
          Sign up
        </Link>
        <Link
          href="/sign-in"
          className="cursor-pointer rounded-xl border border-nh-border bg-transparent px-3.5 py-2 text-xs font-medium text-nh-text transition-colors duration-200 hover:border-nh-teal/40 hover:text-nh-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg sm:px-4 sm:text-sm"
        >
          Sign in
        </Link>
      </Show>
      <Show when="signed-in">
        <UserButton appearance={clerkAppearance} />
      </Show>
    </nav>
  );
}
