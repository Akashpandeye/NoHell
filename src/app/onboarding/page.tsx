"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { OnboardingAnswers } from "@/lib/user-onboarding";

const STEPS = [
  {
    key: "role" as const,
    title: "Where are you in your journey?",
    subtitle:
      "We use this to tune checkpoints and note density — nothing is shared publicly.",
    type: "choice" as const,
    options: [
      "Student",
      "Junior developer (0–2 yrs)",
      "Mid-level or senior",
      "Career switcher",
      "Hobbyist / side projects",
    ],
  },
  {
    key: "stackFocus" as const,
    title: "What’s your main stack or language right now?",
    subtitle: "e.g. TypeScript, Python, React, Go — a few words is enough.",
    type: "text" as const,
    placeholder: "e.g. TypeScript + React",
  },
  {
    key: "learningStyle" as const,
    title: "How do you prefer to learn from tutorials?",
    subtitle: "Pick what you actually do, not what sounds ideal.",
    type: "choice" as const,
    options: [
      "Video walkthroughs",
      "Written docs",
      "Mix of video + docs",
      "Build-along projects only",
    ],
  },
  {
    key: "goalsThreeMonths" as const,
    title: "In the next 3 months, what do you most want to level up?",
    subtitle: "A concrete outcome helps NoHell frame your session goal.",
    type: "area" as const,
    placeholder:
      "e.g. Ship a small full-stack app with auth and a real DB, and explain the architecture in an interview.",
  },
  {
    key: "hoursPerWeek" as const,
    title: "How many hours per week can you realistically study?",
    subtitle: "Honest numbers help us avoid overloading your sessions.",
    type: "choice" as const,
    options: ["Under 5", "5–10", "10–20", "20+"],
  },
  {
    key: "tutorialFrustration" as const,
    title: "What frustrates you most about long coding tutorials?",
    subtitle: "We’re building NoHell to fix this — your answer matters.",
    type: "choice" as const,
    options: [
      "They’re too long / rambling",
      "Too shallow — no depth",
      "I forget everything after",
      "Hard to find the right one",
      "Other",
    ],
  },
] as const;

const emptyAnswers = (): OnboardingAnswers => ({
  role: "",
  stackFocus: "",
  learningStyle: "",
  goalsThreeMonths: "",
  hoursPerWeek: "",
  tutorialFrustration: "",
});

export default function OnboardingPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>(emptyAnswers);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user?.id) {
      router.replace("/sign-in");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/user/onboarding");
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as {
          completed?: boolean;
          answers?: OnboardingAnswers | null;
        };
        if (cancelled) return;
        if (data.completed) {
          router.replace("/");
          return;
        }
        if (data.answers) {
          setAnswers((prev) => ({ ...prev, ...data.answers }));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, user?.id, router]);

  const current = STEPS[step];
  const progress = useMemo(
    () => Math.round(((step + 1) / STEPS.length) * 100),
    [step],
  );

  const canNext = useMemo(() => {
    const k = current.key;
    const v = answers[k].trim();
    return v.length > 0;
  }, [answers, current]);

  const goNext = useCallback(() => {
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  }, [step]);

  const goBack = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  const submit = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/user/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Could not save");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }, [answers, router]);

  if (!isLoaded || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-nh-bg px-4 text-sm text-nh-muted">
        Loading…
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-nh-bg px-4 py-10 text-nh-text sm:px-6">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="font-display text-sm font-semibold text-nh-teal hover:underline"
          >
            ← NoHell
          </Link>
          <span className="font-mono text-xs text-nh-dim">
            Step {step + 1} / {STEPS.length}
          </span>
        </div>

        <div
          className="mb-8 h-1.5 w-full overflow-hidden rounded-full bg-nh-border"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-nh-teal transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
          {current.title}
        </h1>
        <p className="mt-2 text-sm text-nh-muted">{current.subtitle}</p>

        <div className="mt-8">
          {current.type === "choice" ? (
            <ul className="space-y-2">
              {current.options.map((opt) => {
                const selected = answers[current.key] === opt;
                return (
                  <li key={opt}>
                    <button
                      type="button"
                      onClick={() =>
                        setAnswers((a) => ({ ...a, [current.key]: opt }))
                      }
                      className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                        selected
                          ? "border-nh-teal bg-nh-surface-2 text-nh-text"
                          : "border-nh-border bg-nh-surface text-nh-muted hover:border-nh-teal/40"
                      }`}
                    >
                      {opt}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          {current.type === "text" ? (
            <input
              type="text"
              autoComplete="off"
              value={answers[current.key]}
              onChange={(e) =>
                setAnswers((a) => ({
                  ...a,
                  [current.key]: e.target.value,
                }))
              }
              placeholder={current.placeholder}
              className="w-full rounded-xl border border-nh-border bg-nh-surface px-4 py-3 font-mono text-sm text-nh-text placeholder:text-nh-dim focus:border-nh-teal focus:outline-none focus:ring-2 focus:ring-nh-teal/30"
            />
          ) : null}

          {current.type === "area" ? (
            <textarea
              rows={5}
              value={answers[current.key]}
              onChange={(e) =>
                setAnswers((a) => ({
                  ...a,
                  [current.key]: e.target.value,
                }))
              }
              placeholder={current.placeholder}
              className="w-full resize-y rounded-xl border border-nh-border bg-nh-surface px-4 py-3 text-sm text-nh-text placeholder:text-nh-dim focus:border-nh-teal focus:outline-none focus:ring-2 focus:ring-nh-teal/30"
            />
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 text-sm text-orange-300" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-10 flex flex-wrap items-center gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={goBack}
              className="rounded-xl border border-nh-border px-5 py-2.5 text-sm font-medium text-nh-text hover:bg-nh-surface"
            >
              Back
            </button>
          ) : null}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!canNext}
              onClick={goNext}
              className="rounded-xl bg-nh-cta px-6 py-2.5 text-sm font-bold text-neutral-950 hover:bg-nh-cta-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              disabled={!canNext || saving}
              onClick={() => void submit()}
              className="rounded-xl bg-nh-cta px-6 py-2.5 text-sm font-bold text-neutral-950 hover:bg-nh-cta-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Finish & go to NoHell"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
