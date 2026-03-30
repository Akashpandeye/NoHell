"use client";

import { useUser } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { user, isLoaded } = useUser();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded || !user?.id) return;
    if (pathname !== "/onboarding") return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/user/onboarding", {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { completed?: boolean };
        const completed = data.completed === true;

        if (completed) {
          router.replace("/");
        }
      } catch {
        /* gate is best-effort on client */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, pathname, router, user?.id]);

  return <>{children}</>;
}

