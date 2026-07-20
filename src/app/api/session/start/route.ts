import { auth } from "@clerk/nextjs/server";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  completeWithOpenRouter,
  isOpenRouterConfigured,
} from "@/lib/ai/openrouter";
import { resolveVideoTranscript } from "@/lib/server-transcripts";
import type { TranscriptLine, TranscriptResolution } from "@/lib/transcript";
import type { Checkpoint } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT =
  "You are a learning assistant for junior developers. Respond ONLY in valid JSON. No markdown, no text outside the JSON.";

type StartBody = {
  videoId?: string;
  goal?: string;
  idempotencyKey?: string;
};

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckpointRaw = {
  id?: string;
  title?: string;
  description?: string;
  estimated_minute?: number;
};

function firstNWordsFromTranscript(
  transcript: TranscriptLine[],
  wordCount: number,
): string {
  const full = transcript.map((line) => line.text).join(" ").trim();
  if (!full) return "";
  return full.split(/\s+/).filter(Boolean).slice(0, wordCount).join(" ");
}

function parseCheckpointsJson(text: string): CheckpointRaw[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const parsed = JSON.parse(fenced ? fenced[1]!.trim() : trimmed) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("checkpoints" in parsed) ||
    !Array.isArray((parsed as { checkpoints: unknown }).checkpoints)
  ) {
    throw new Error("Invalid checkpoint response");
  }
  return (parsed as { checkpoints: CheckpointRaw[] }).checkpoints;
}

function toCheckpoint(raw: CheckpointRaw, index: number): Checkpoint {
  const id = String(raw.id ?? `checkpoint-${index + 1}`);
  const label = String(raw.title ?? `Checkpoint ${index + 1}`);
  const parts = [raw.description != null ? String(raw.description) : ""];
  if (raw.estimated_minute != null && Number.isFinite(raw.estimated_minute)) {
    parts.push(`~${Math.round(raw.estimated_minute)} min`);
  }
  return {
    id,
    label,
    summary: parts.filter(Boolean).join(" — ") || undefined,
    timestampSeconds: 0,
    completed: false,
  };
}

function fallbackCheckpoints(goal: string): Checkpoint[] {
  return [
    {
      id: "cp-1",
      label: "Getting started",
      summary: goal,
      timestampSeconds: 0,
      completed: false,
    },
    {
      id: "cp-2",
      label: "Core concepts",
      timestampSeconds: 0,
      completed: false,
    },
    {
      id: "cp-3",
      label: "Practice & wrap-up",
      timestampSeconds: 0,
      completed: false,
    },
  ];
}

async function fetchYouTubeTitle(videoId: string): Promise<string> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  try {
    const response = await fetch(oembedUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!response.ok) return "YouTube video";
    const data = (await response.json()) as { title?: string };
    return typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : "YouTube video";
  } catch {
    return "YouTube video";
  }
}

async function generateCheckpoints({
  goal,
  videoTitle,
  transcript,
  userLevel,
  techFocus,
}: {
  goal: string;
  videoTitle: string;
  transcript: TranscriptLine[];
  userLevel: string;
  techFocus: string;
}): Promise<Checkpoint[] | null> {
  if (!isOpenRouterConfigured()) return null;
  const preview =
    firstNWordsFromTranscript(transcript, 500) ||
    `Video title: "${videoTitle}". Learner goal: ${goal}.`;
  const userPrompt = `Break this learning goal into 3-5 checkpoints for this coding tutorial.
GOAL: ${goal}
TRANSCRIPT_PREVIEW: ${preview}
USER LEVEL: ${userLevel}
TECH FOCUS: ${techFocus}
Adjust checkpoint difficulty and language accordingly.
For beginners use simpler language and smaller steps.
For juniors assume basic syntax knowledge.
Return ONLY: {checkpoints:[{id,title,description,estimated_minute}]}`;

  try {
    const text = await completeWithOpenRouter(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 1000, temperature: 0.3 },
    );
    const rawList = parseCheckpointsJson(text);
    return rawList.length > 0
      ? rawList.slice(0, 5).map((raw, index) => toCheckpoint(raw, index))
      : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const suppliedIdempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const idempotencyKey = UUID.test(suppliedIdempotencyKey)
    ? suppliedIdempotencyKey
    : randomUUID();

  if (!YOUTUBE_VIDEO_ID.test(videoId) || !goal || goal.length > 2_000) {
    return NextResponse.json(
      {
        error:
          "A valid YouTube video ID and a goal of up to 2,000 characters are required",
      },
      { status: 400 },
    );
  }

  const videoTitle = await fetchYouTubeTitle(videoId);
  const fallback = fallbackCheckpoints(goal);
  const startedAt = new Date();
  const {
    serverBeginLearningSession,
    serverGetUserProfile,
    serverUpdateSessionForUser,
  } = await import("@/lib/server-firestore");

  let sessionId: string;
  let admissionOutcome: "created" | "existing";
  try {
    const admission = await serverBeginLearningSession(
      {
        userId,
        videoId,
        videoTitle,
        goal,
        checkpoints: fallback,
        status: "active",
        startedAt,
        endedAt: null,
        totalWatchSeconds: 0,
      },
      idempotencyKey,
    );
    if (admission.outcome === "limit_reached" || !admission.sessionId) {
      return NextResponse.json(
        { error: "Free limit reached", code: "LIMIT_REACHED" },
        { status: 403 },
      );
    }
    sessionId = admission.sessionId;
    admissionOutcome = admission.outcome;
  } catch {
    return NextResponse.json(
      { error: "Failed to start session" },
      { status: 500 },
    );
  }

  if (admissionOutcome === "existing") {
    return NextResponse.json({
      sessionId,
      checkpoints: fallback,
      transcriptStatus: "fetching",
    });
  }

  let transcriptResult: TranscriptResolution;
  try {
    transcriptResult = await resolveVideoTranscript(videoId);
  } catch {
    transcriptResult = {
      status: "failed",
      error: {
        code: "cache_error",
        message: "Transcript service is temporarily unavailable.",
        retryable: true,
        provider: "cache",
      },
      retryAfter: null,
    };
  }

  let checkpoints = fallback;
  if (transcriptResult.status === "ready") {
    let userLevel = "junior";
    let techFocus = "general";
    try {
      const profile = await serverGetUserProfile(userId);
      if (profile?.profile?.level) userLevel = profile.profile.level;
      if (profile?.profile?.techFocus) techFocus = profile.profile.techFocus;
    } catch {
      /* optional personalization */
    }

    const generated = await generateCheckpoints({
      goal,
      videoTitle,
      transcript: transcriptResult.lines,
      userLevel,
      techFocus,
    });
    if (generated) {
      checkpoints = generated;
      try {
        await serverUpdateSessionForUser(sessionId, userId, { checkpoints });
      } catch {
        /* fallback checkpoints remain saved */
      }
    }
  }

  return NextResponse.json({
    sessionId,
    checkpoints,
    transcriptStatus: transcriptResult.status,
  });
}
