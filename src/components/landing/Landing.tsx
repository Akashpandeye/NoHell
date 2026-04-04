"use client";

import { useCallback, useId, useRef, useState } from "react";

import { useUser } from "@clerk/nextjs";
import { ArrowRight, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthNav } from "@/components/auth/AuthNav";
import { UpgradeModal } from "@/components/billing/UpgradeModal";

import { AimMark } from "../brand/AimMark";

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([^&?/\s]{11})/);
  return m ? m[1] : null;
}

const featurePoints = [
  "AI notes in real-time",
  "hourly revision cards",
  "session recall",
] as const;

const goalPresets = [
  "Understand the core concepts",
  "Build along with the tutorial",
  "Learn the syntax and patterns",
  "Prepare for an interview",
  "Quick overview / refresher",
] as const;

type Step = "url" | "goal";

export function Landing() {
  const urlId = useId();
  const goalId = useId();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [step, setStep] = useState<Step>("url");
  const [phase, setPhase] = useState<"idle" | "out" | "in">("idle");
  const [status, setStatus] = useState<"idle" | "error">("idle");
  const [message, setMessage] = useState("");
  const [starting, setStarting] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const pendingStep = useRef<Step | null>(null);

  const transitionTo = useCallback(
    (next: Step) => {
      if (next === step) return;
      pendingStep.current = next;
      setPhase("out");
      setTimeout(() => {
        if (pendingStep.current == null) return;
        setStep(pendingStep.current);
        setPhase("in");
        setTimeout(() => setPhase("idle"), 20);
      }, 250);
    },
    [step],
  );

  const handleUrlNext = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      setStatus("error");
      setMessage("Paste a YouTube link to continue.");
      return;
    }
    const videoId = extractVideoId(trimmed);
    if (!videoId) {
      setStatus("error");
      setMessage("Use a valid YouTube watch or youtu.be URL.");
      return;
    }
    if (!isLoaded) {
      setStatus("error");
      setMessage("Please wait…");
      return;
    }
    if (!user?.id) {
      router.push(`/sign-up?url=${encodeURIComponent(trimmed)}`);
      return;
    }
    setStatus("idle");
    setMessage("");
    transitionTo("goal");
  }, [url, isLoaded, user, router, transitionTo]);

  const handleStart = useCallback(async () => {
    const trimmed = url.trim();
    const goalTrimmed = goal.trim();
    const videoId = extractVideoId(trimmed);
    if (!videoId || !user?.id) return;

    if (!goalTrimmed) {
      setStatus("error");
      setMessage("Add a short learning goal for this session.");
      return;
    }

    setStarting(true);
    setStatus("idle");
    setMessage("");
    try {
      const res = await fetch("/api/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          goal: goalTrimmed,
          userId: user.id,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        code?: string;
        sessionId?: string;
      };

      if (res.status === 403 && data.code === "LIMIT_REACHED") {
        setShowUpgrade(true);
        setStatus("error");
        setMessage("You've reached the free session limit.");
        return;
      }

      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Could not start session.");
        return;
      }

      if (data.sessionId) {
        router.push(`/session/${data.sessionId}`);
        return;
      }

      setStatus("error");
      setMessage("Unexpected response from server.");
    } catch {
      setStatus("error");
      setMessage("Network error — try again.");
    } finally {
      setStarting(false);
    }
  }, [url, goal, user, router]);

  const translateClass =
    phase === "out"
      ? "-translate-x-8 opacity-0"
      : phase === "in"
        ? "translate-x-8 opacity-0"
        : "translate-x-0 opacity-100";

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_50%_58%,var(--nh-teal-glow),transparent_72%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-64 w-[min(100%,48rem)] -translate-x-1/2 rounded-full bg-nh-teal/5 blur-3xl"
      />

      <header className="relative z-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 pb-1 pt-6 sm:px-6 sm:pt-8 lg:px-8">
          <Link
            href="/"
            className="group relative flex cursor-pointer items-center gap-2.5 pb-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/50 focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg sm:gap-3"
          >
            <AimMark className="h-7 w-7 shrink-0 text-nh-cta transition-transform duration-300 group-hover:scale-105 sm:h-8 sm:w-8" />
            <span className="font-display text-xl font-extrabold tracking-[-0.03em] text-nh-text transition-colors duration-300 group-hover:text-nh-teal sm:text-2xl">
              NoHell
            </span>
            <span
              aria-hidden
              className="absolute bottom-0 left-0 h-px w-0 bg-gradient-to-r from-nh-teal to-nh-cta transition-[width] duration-500 ease-out group-hover:w-full"
            />
          </Link>
          <AuthNav />
        </div>
        <div
          aria-hidden
          className="mx-auto mt-4 h-px max-w-6xl bg-gradient-to-r from-transparent via-nh-border to-transparent px-4 sm:px-6 lg:px-8"
        />
      </header>

      <main
        id="main"
        className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6 sm:py-20 lg:px-8"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          <p className="mb-5 font-display text-[11px] font-bold uppercase tracking-[0.4em] text-nh-teal">
            NoHell
          </p>
          <h1 className="font-display text-4xl font-extrabold leading-[1.06] tracking-[-0.04em] text-nh-text sm:text-5xl lg:text-[3.35rem]">
            Skip tutorial hell.
            <br />
            <span className="bg-gradient-to-r from-nh-teal via-teal-300/90 to-nh-cta/90 bg-clip-text text-transparent">
              Stay in flow.
            </span>
          </h1>
          <p className="mt-5 max-w-md text-pretty font-mono text-[13px] leading-relaxed tracking-wide text-[#c9aa8c] sm:text-sm">
            Paste any Tutorial from YouTube. Get AI notes, hourly revision
            cards, and recall questions as you watch.
          </p>

          <div
            className={`mt-10 w-full max-w-xl transition-all duration-250 ease-out ${translateClass}`}
          >
            {/* ---------- STEP 1: Paste URL ---------- */}
            {step === "url" && (
              <div>
                <label htmlFor={urlId} className="sr-only">
                  YouTube tutorial URL
                </label>
                <div className="flex flex-col gap-3 sm:flex-row sm:rounded-xl sm:border sm:border-nh-border sm:bg-nh-surface sm:p-1 sm:shadow-sm">
                  <input
                    id={urlId}
                    name="url"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      if (status !== "idle") {
                        setStatus("idle");
                        setMessage("");
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleUrlNext();
                      }
                    }}
                    className="min-h-12 w-full rounded-xl border border-nh-border bg-nh-surface px-4 py-3 font-mono text-[13px] text-nh-text placeholder:text-nh-dim transition-[border-color,box-shadow] duration-200 focus-visible:border-nh-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/35 sm:border-0 sm:bg-transparent sm:py-3.5"
                  />
                  <button
                    type="button"
                    onClick={handleUrlNext}
                    className="font-display inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-nh-cta px-6 text-sm font-bold text-neutral-950 shadow-sm transition-[background-color,transform] duration-200 hover:bg-nh-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-cta focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg active:translate-y-px sm:shrink-0 sm:px-7"
                  >
                    Next
                    <ArrowRight
                      className="h-4 w-4"
                      strokeWidth={2}
                      aria-hidden
                    />
                  </button>
                </div>
              </div>
            )}

            {/* ---------- STEP 2: Describe your goal ---------- */}
            {step === "goal" && (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setStatus("idle");
                    setMessage("");
                    transitionTo("url");
                  }}
                  className="mb-4 inline-flex items-center gap-1 text-xs text-nh-muted transition-colors hover:text-nh-text"
                >
                  <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
                  Change link
                </button>

                <div className="mb-5 flex items-center justify-center">
                  <span className="max-w-full truncate rounded-lg border border-nh-border bg-nh-surface px-3 py-1.5 font-mono text-[11px] text-nh-muted">
                    {url.trim()}
                  </span>
                </div>

                <h2 className="font-display text-xl font-bold text-nh-text sm:text-2xl">
                  Describe your goal
                </h2>
                <p className="mt-1.5 text-sm text-nh-muted">
                  What do you want to get out of this tutorial?
                </p>

                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {goalPresets.map((preset) => {
                    const active = goal === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setGoal(preset);
                          if (status !== "idle") {
                            setStatus("idle");
                            setMessage("");
                          }
                        }}
                        className={`rounded-full border px-3.5 py-2 text-xs transition-colors ${
                          active
                            ? "border-nh-cta bg-nh-cta/10 text-nh-text"
                            : "border-nh-border text-nh-muted hover:border-nh-cta/50"
                        }`}
                      >
                        {preset}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5">
                  <label htmlFor={goalId} className="sr-only">
                    Learning goal
                  </label>
                  <input
                    id={goalId}
                    name="goal"
                    type="text"
                    autoComplete="off"
                    placeholder="Or type your own goal…"
                    value={goal}
                    onChange={(e) => {
                      setGoal(e.target.value);
                      if (status !== "idle") {
                        setStatus("idle");
                        setMessage("");
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleStart();
                      }
                    }}
                    className="min-h-12 w-full rounded-xl border border-nh-border bg-nh-surface px-4 py-3 text-left font-mono text-[13px] text-nh-text placeholder:text-nh-dim transition-[border-color,box-shadow] duration-200 focus-visible:border-nh-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/35"
                  />
                </div>

                <button
                  type="button"
                  disabled={starting || !goal.trim()}
                  onClick={() => void handleStart()}
                  className="font-display mt-5 inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-nh-cta px-6 text-sm font-bold text-neutral-950 shadow-sm transition-[background-color,transform] duration-200 hover:bg-nh-cta-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-cta focus-visible:ring-offset-2 focus-visible:ring-offset-nh-bg active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {starting ? "Starting…" : "Start Session"}
                  <ArrowRight
                    className="h-4 w-4"
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>
              </div>
            )}
          </div>

          {message ? (
            <p
              role={status === "error" ? "alert" : "status"}
              className={`mt-3 w-full max-w-xl text-left text-xs sm:text-sm ${
                status === "error" ? "text-orange-300" : "text-nh-muted"
              }`}
            >
              {message}
            </p>
          ) : null}

          <ul
            id="benefits"
            className="mt-10 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 scroll-mt-28 sm:mt-12 sm:gap-x-10"
            aria-label="What you get"
          >
            {featurePoints.map((label) => (
              <li
                key={label}
                className="flex items-center gap-2 font-mono text-[11px] tracking-wide text-nh-bullet-text sm:text-xs"
              >
                <span className="select-none text-nh-cta" aria-hidden>
                  ◆
                </span>
                <span className="lowercase">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>

      <footer className="relative z-10 border-t border-nh-border/40 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-center text-xs text-nh-dim sm:flex-row sm:text-left">
          <p>NoHell — focus and skip tutorial hell.</p>
          <p className="text-nh-muted">
            Landing preview · Product in development
          </p>
        </div>
      </footer>
    </div>
  );
}
