"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { UserLearningProfile } from "@/types";

type OnboardingAnswers = UserLearningProfile;

const MAX_PAIN_POINTS = 3;
const LAST_STEP = 7;

const levelOptions = [
  {
    label: "Complete beginner — I'm just starting out",
    value: "beginner",
  },
  {
    label: "Junior — I know the basics, still learning a lot",
    value: "junior",
  },
  {
    label: "Self-taught — mix of knowledge, lots of gaps",
    value: "self-taught",
  },
  {
    label: "Career switcher — coming from a different field",
    value: "switcher",
  },
] as const;

const mediumGoalOptions = [
  "Get my first dev job",
  "Build and launch my own project",
  "Become confident with a specific tech stack",
  "Upskill at my current job",
] as const;

const painPointOptions = [
  "I watch but don't retain anything",
  "I get lost when the instructor moves too fast",
  "I finish the tutorial but can't build anything without it",
  "I get distracted and lose my place",
  "I don't know which tutorial to watch next",
  "I rewatch the same sections over and over",
  "I fall asleep or zone out after 30 minutes",
  "The tutorial is outdated and breaks halfway through",
] as const;

const sessionLengthOptions = [
  { label: "30 minutes or less", value: "30" },
  { label: "30 to 60 minutes", value: "60" },
  { label: "1 to 2 hours", value: "120" },
  { label: "2+ hours (I go deep)", value: "120+" },
] as const;

const techFocusOptions = [
  "Frontend (React, Next.js, CSS)",
  "Backend (Node, Python, databases)",
  "Full-stack (MERN, MEAN, T3)",
  "Mobile (React Native, Flutter)",
  "DevOps / Cloud",
  "AI / Machine Learning",
] as const;

const noteStyleOptions = [
  "I don't — I just rewatch when I forget",
  "I write in a notebook by hand",
  "I use Notion / Google Docs",
  "I paste code snippets into a file",
] as const;

const emptyAnswers = (): OnboardingAnswers => ({
  level: "beginner",
  mediumTermGoal: "",
  painPoints: [],
  sessionLength: "60",
  techFocus: "",
  noteStyle: "",
});

export default function OnboardingPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>(emptyAnswers);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const pendingStep = useRef<number | null>(null);

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
          profile?: OnboardingAnswers | null;
        };
        if (cancelled) return;
        if (data.completed) {
          router.replace("/");
          return;
        }
        if (data.profile) {
          setAnswers((prev) => ({ ...prev, ...data.profile }));
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

  const progressLabel = useMemo(
    () => `${Math.min(currentStep, 7)}/7`,
    [currentStep],
  );
  const progressPct = useMemo(
    () => (Math.min(currentStep, 7) / 7) * 100,
    [currentStep],
  );

  const transitionTo = useCallback(
    (nextStep: number, dir: 1 | -1) => {
      if (nextStep < 0 || nextStep > LAST_STEP || nextStep === currentStep) return;
      setDirection(dir);
      pendingStep.current = nextStep;
      setPhase("out");
      window.setTimeout(() => {
        if (pendingStep.current == null) return;
        setCurrentStep(pendingStep.current);
        setPhase("in");
        window.setTimeout(() => setPhase("idle"), 20);
      }, 250);
    },
    [currentStep],
  );

  const goNext = useCallback(() => transitionTo(currentStep + 1, 1), [
    currentStep,
    transitionTo,
  ]);

  const goBack = useCallback(() => transitionTo(currentStep - 1, -1), [
    currentStep,
    transitionTo,
  ]);

  const canNext = useMemo(() => {
    if (currentStep === 0 || currentStep === 7) return true;
    if (currentStep === 1) return !!answers.level;
    if (currentStep === 2) return answers.mediumTermGoal.trim().length > 0;
    if (currentStep === 3) return answers.painPoints.length > 0;
    if (currentStep === 4) return !!answers.sessionLength;
    if (currentStep === 5) return answers.techFocus.trim().length > 0;
    if (currentStep === 6) return answers.noteStyle.trim().length > 0;
    return false;
  }, [answers, currentStep]);

  const submit = useCallback(async () => {
    setIsSubmitting(true);
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
      router.replace("/pricing");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setIsSubmitting(false);
    }
  }, [answers, router]);

  const selectSingleAndAdvance = useCallback(
    (
      patch: Partial<OnboardingAnswers>,
      stepIndex: number,
      nextDelayMs = 300,
    ) => {
      setAnswers((prev) => ({ ...prev, ...patch }));
      if (currentStep !== stepIndex) return;
      window.setTimeout(() => transitionTo(stepIndex + 1, 1), nextDelayMs);
    },
    [currentStep, transitionTo],
  );

  const togglePainPoint = useCallback((value: string) => {
    setAnswers((prev) => {
      const exists = prev.painPoints.includes(value);
      if (exists) {
        return {
          ...prev,
          painPoints: prev.painPoints.filter((x) => x !== value),
        };
      }
      if (prev.painPoints.length >= MAX_PAIN_POINTS) return prev;
      return { ...prev, painPoints: [...prev.painPoints, value] };
    });
  }, []);

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

  const summary = `You're a ${answers.level} dev focused on ${answers.techFocus || "your chosen stack"}, working toward ${answers.mediumTermGoal || "your next milestone"}. NoHell will keep your sessions under ${answers.sessionLength} minutes and focus on retention — not just watching.`;

  const translateClass =
    phase === "out"
      ? direction === 1
        ? "-translate-x-10 opacity-0"
        : "translate-x-10 opacity-0"
      : phase === "in"
        ? direction === 1
          ? "translate-x-10 opacity-0"
          : "-translate-x-10 opacity-0"
        : "translate-x-0 opacity-100";

  return (
    <div className="min-h-screen bg-nh-bg px-4 py-10 text-nh-text sm:px-6">
      <div className="mx-auto max-w-[560px]">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="font-display text-sm font-semibold text-nh-teal hover:underline"
          >
            NoHell
          </Link>
          <span className="font-mono text-xs text-nh-dim">
            {progressLabel}
          </span>
        </div>

        <div
          className="mb-8 h-1.5 w-full overflow-hidden rounded-full bg-nh-border"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-nh-teal transition-[width] duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div
          className={`rounded-2xl border border-nh-border bg-nh-surface p-6 transition-all duration-250 ease-out ${translateClass}`}
          style={{ transformOrigin: "center" }}
        >
          {currentStep === 0 ? (
            <>
              <h1 className="font-display text-3xl font-bold leading-tight">
                Let&apos;s set up your learning profile
              </h1>
              <p className="mt-3 text-sm text-nh-muted">
                7 quick questions so NoHell can make your sessions smarter.
                Takes about 2 minutes.
              </p>
            </>
          ) : null}

          {currentStep === 1 ? (
            <>
              <h2 className="font-display text-2xl font-bold leading-tight">
                What&apos;s your current level as a developer?
              </h2>
              <ul className="mt-6 space-y-3">
                {levelOptions.map((opt) => {
                  const selected = answers.level === opt.value;
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                          selected
                            ? "border-amber-400 bg-amber-400/10 text-nh-text"
                            : "border-nh-border bg-nh-surface-2 text-nh-muted hover:border-amber-400/60"
                        }`}
                        onClick={() =>
                          selectSingleAndAdvance({ level: opt.value }, 1)
                        }
                      >
                        {opt.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {currentStep === 2 ? (
            <>
              <h2 className="font-display text-2xl font-bold leading-tight">
                What&apos;s your medium-term target? (next 3-6 months)
              </h2>
              <ul className="mt-6 space-y-3">
                {mediumGoalOptions.map((opt) => {
                  const selected = answers.mediumTermGoal === opt;
                  return (
                    <li key={opt}>
                      <button
                        type="button"
                        className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                          selected
                            ? "border-amber-400 bg-amber-400/10 text-nh-text"
                            : "border-nh-border bg-nh-surface-2 text-nh-muted hover:border-amber-400/60"
                        }`}
                        onClick={() =>
                          selectSingleAndAdvance({ mediumTermGoal: opt }, 2)
                        }
                      >
                        {opt}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {currentStep === 3 ? (
            <>
              <h2 className="font-display text-2xl font-bold leading-tight">
                What kills your momentum when watching coding tutorials?
              </h2>
              <p className="mt-2 text-xs text-nh-muted">
                Pick up to {MAX_PAIN_POINTS}. Selected: {answers.painPoints.length}
              </p>
              <div className="mt-6 flex flex-wrap gap-2">
                {painPointOptions.map((opt) => {
                  const selected = answers.painPoints.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => togglePainPoint(opt)}
                      className={`rounded-full border px-3 py-2 text-xs transition-colors ${
                        selected
                          ? "border-amber-400 bg-amber-400/10 text-nh-text"
                          : "border-nh-border text-nh-muted hover:border-amber-400/60"
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {currentStep === 4 ? (
            <>
              <h2 className="font-display text-2xl font-bold leading-tight">
                How long can you realistically focus in one sitting?
              </h2>
              <ul className="mt-6 space-y-3">
                {sessionLengthOptions.map((opt) => {
                  const selected = answers.sessionLength === opt.value;
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                          selected
                            ? "border-amber-400 bg-amber-400/10 text-nh-text"
                            : "border-nh-border bg-nh-surface-2 text-nh-muted hover:border-amber-400/60"
                        }`}
                        onClick={() =>
                          selectSingleAndAdvance(
                            { sessionLength: opt.value },
                            4,
                          )
                        }
                      >
                        {opt.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {currentStep === 5 ? (
            <>
              <h2 className="font-display text-2xl font-bold leading-tight">
                What are you mainly trying to learn right now?
              </h2>
              <ul className="mt-6 space-y-3">
                {techFocusOptions.map((opt) => {
                  const selected = answers.techFocus === opt;
                  return (
                    <li key={opt}>
                      <button
                        type="button"
                        className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                          selected
                            ? "border-amber-400 bg-amber-400/10 text-nh-text"
                            : "border-nh-border bg-nh-surface-2 text-nh-muted hover:border-amber-400/60"
                        }`}
                        onClick={() =>
                          selectSingleAndAdvance({ techFocus: opt }, 5)
                        }
                      >
                        {opt}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {currentStep === 6 ? (
            <>
              <h2 className="font-display text-2xl font-bold leading-tight">
                How do you normally take notes while learning?
              </h2>
              <ul className="mt-6 space-y-3">
                {noteStyleOptions.map((opt) => {
                  const selected = answers.noteStyle === opt;
                  return (
                    <li key={opt}>
                      <button
                        type="button"
                        className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                          selected
                            ? "border-amber-400 bg-amber-400/10 text-nh-text"
                            : "border-nh-border bg-nh-surface-2 text-nh-muted hover:border-amber-400/60"
                        }`}
                        onClick={() =>
                          selectSingleAndAdvance({ noteStyle: opt }, 6)
                        }
                      >
                        {opt}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}

          {currentStep === 7 ? (
            <>
              <h2 className="font-display text-3xl font-bold leading-tight">
                You&apos;re all set.
              </h2>
              <p className="mt-4 text-sm text-nh-muted">{summary}</p>
            </>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 text-sm text-orange-300" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            disabled={currentStep === 0 || isSubmitting}
            className="rounded-xl border border-nh-border px-5 py-2.5 text-sm font-medium text-nh-text hover:bg-nh-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            Back
          </button>
          {currentStep === 0 ? (
            <button
              type="button"
              onClick={goNext}
              className="rounded-xl bg-nh-cta px-6 py-2.5 text-sm font-bold text-neutral-950 hover:bg-nh-cta-hover"
            >
              Let&apos;s go →
            </button>
          ) : null}
          {currentStep > 0 && currentStep < 7 ? (
            <button
              type="button"
              disabled={!canNext}
              onClick={goNext}
              className="rounded-xl bg-nh-cta px-6 py-2.5 text-sm font-bold text-neutral-950 hover:bg-nh-cta-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          ) : null}
          {currentStep === 7 ? (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void submit()}
              className="rounded-xl bg-nh-cta px-6 py-2.5 text-sm font-bold text-neutral-950 hover:bg-nh-cta-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isSubmitting ? "Saving…" : "Continue"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
