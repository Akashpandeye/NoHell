import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

import { AimMark } from "@/components/brand/AimMark";
import { clerkAppearance } from "@/lib/clerk-appearance";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-nh-bg px-4 py-10">
      <header className="mx-auto mb-10 flex max-w-md justify-center">
        <Link
          href="/"
          className="group flex cursor-pointer items-center gap-2.5 rounded-xl pb-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg"
        >
          <AimMark className="h-8 w-8 shrink-0 text-nh-cta transition-transform duration-300 group-hover:scale-105" />
          <span className="font-display text-lg font-extrabold tracking-[-0.03em] text-nh-text transition-colors group-hover:text-nh-teal">
            NoHell
          </span>
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-md justify-center">
        <SignIn
          appearance={clerkAppearance}
          fallbackRedirectUrl="/"
          signUpUrl="/sign-up"
        />
      </div>
    </div>
  );
}
