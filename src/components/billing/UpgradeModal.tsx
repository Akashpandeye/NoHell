"use client";

import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { PRO_PRICE_USD } from "@/lib/pricing";

type UpgradeModalProps = {
  open: boolean;
  onClose: () => void;
};

export function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onUpgrade = useCallback(async () => {
    if (!user?.id) return;
    setBusy(true);
    setError(null);
    try {
      await openRazorpayCheckout({
        userId: user.id,
        email: user.primaryEmailAddress?.emailAddress,
        onSuccess: () => {
          setSuccess(true);
          router.refresh();
          window.setTimeout(() => {
            onClose();
            setSuccess(false);
          }, 1600);
        },
        onFailure: (msg) => {
          setError(msg);
        },
      });
    } finally {
      setBusy(false);
    }
  }, [user, onClose, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
    >
      <div className="relative w-full max-w-md border border-nh-border bg-nh-surface p-6 shadow-xl">
        <button
          type="button"
          className="absolute right-3 top-3 text-nh-muted hover:text-nh-text"
          onClick={onClose}
          aria-label="Close"
        >
          ×
        </button>

        {success ? (
          <p className="text-center text-sm text-nh-teal">
            You&apos;re now on Pro!
          </p>
        ) : (
          <>
            <h2
              id="upgrade-title"
              className="font-display pr-8 text-xl font-bold text-nh-text"
            >
              You&apos;ve used your 5 free sessions
            </h2>
            <p className="mt-2 text-sm text-nh-muted">
              Upgrade to Pro for unlimited sessions, revision history, and full
              note exports.
            </p>

            <ul className="mt-4 space-y-2 text-sm text-nh-text">
              <li className="flex gap-2">
                <span className="text-nh-cta">✓</span>
                <span>Unlimited sessions</span>
              </li>
              <li className="flex gap-2">
                <span className="text-nh-cta">✓</span>
                <span>Full AI notes export</span>
              </li>
              <li className="flex gap-2">
                <span className="text-nh-cta">✓</span>
                <span>Revision card history</span>
              </li>
            </ul>

            <p className="mt-5 font-mono text-lg font-semibold text-nh-text">
              ${PRO_PRICE_USD}
              <span className="text-sm font-normal text-nh-muted">/month</span>
            </p>

            {error ? (
              <p className="mt-2 text-xs text-orange-300" role="alert">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              disabled={!isLoaded || !user?.id || busy}
              className="mt-5 w-full rounded-xl bg-nh-cta py-3 text-sm font-bold text-neutral-950 transition-colors hover:bg-nh-cta-hover disabled:opacity-50"
              onClick={() => void onUpgrade()}
            >
              {busy ? "Opening…" : "Upgrade to Pro"}
            </button>

            <button
              type="button"
              className="mt-3 w-full text-center text-xs text-nh-muted underline hover:text-nh-text"
              onClick={onClose}
            >
              Maybe later
            </button>
          </>
        )}
      </div>
    </div>
  );
}
