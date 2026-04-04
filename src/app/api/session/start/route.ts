import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

import { fetchYouTubeTranscriptLines } from "@/lib/fetch-youtube-transcript";
import {
  splitTranscriptByTime,
  type TranscriptChunk,
  type TranscriptLine,
} from "@/lib/transcript";
import type { Checkpoint } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "llama-3.3-70b-versatile";
const SYSTEM_PROMPT =
  "You are a learning assistant for junior developers. Respond ONLY in valid JSON. No markdown, no text outside the JSON.";

type StartBody = {
  videoId?: string;
  goal?: string;
  userId?: string;
};

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
  const full = transcript.map((t) => t.text).join(" ").trim();
  if (!full) return "";
  const words = full.split(/\s+/).filter(Boolean);
  return words.slice(0, wordCount).join(" ");
}

function parseCheckpointsJson(text: string): CheckpointRaw[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1]!.trim() : trimmed;
  const parsed = JSON.parse(jsonStr) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("checkpoints" in parsed) ||
    !Array.isArray((parsed as { checkpoints: unknown }).checkpoints)
  ) {
    throw new Error("Invalid JSON shape: expected { checkpoints: [...] }");
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
  const summary = parts.filter(Boolean).join(" — ") || undefined;
  return {
    id,
    label,
    summary,
    timestampSeconds: 0,
    completed: false,
  };
}

function fallbackCheckpoints(goal: string): Checkpoint[] {
  return [
    { id: "cp-1", label: "Getting started", summary: goal, timestampSeconds: 0, completed: false },
    { id: "cp-2", label: "Core concepts", timestampSeconds: 0, completed: false },
    { id: "cp-3", label: "Practice & wrap-up", timestampSeconds: 0, completed: false },
  ];
}

async function fetchYouTubeTitle(videoId: string): Promise<string> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  try {
    const res = await fetch(oembedUrl, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });
    if (!res.ok) return "YouTube video";
    const data = (await res.json()) as { title?: string };
    return typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : "YouTube video";
  } catch {
    return "YouTube video";
  }
}

export async function POST(request: NextRequest) {
  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const videoId = typeof body.videoId === "string" ? body.videoId.trim() : "";
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";

  if (!videoId || !goal || !userId) {
    return NextResponse.json(
      { error: "videoId, goal, and userId are required" },
      { status: 400 },
    );
  }

  const { serverCanStartSession, serverIncrementUsage } = await import(
    "@/lib/server-firestore"
  );
  const allowed = await serverCanStartSession(userId);
  if (!allowed) {
    return NextResponse.json(
      {
        error: "Free limit reached",
        code: "LIMIT_REACHED",
        status: 403,
      },
      { status: 403 },
    );
  }

  const videoTitle = await fetchYouTubeTitle(videoId);

  const tResult = await fetchYouTubeTranscriptLines(videoId);
  const transcriptUnavailable = !tResult.ok;
  const transcript: TranscriptLine[] = tResult.ok ? tResult.lines : [];
  const chunked: TranscriptChunk[] = splitTranscriptByTime(transcript, 5);

  const preview =
    firstNWordsFromTranscript(transcript, 500) ||
    `Video title: "${videoTitle}". Learner goal: ${goal}. (No caption text from YouTube — common on cloud hosts; infer checkpoints from goal and typical coding-tutorial structure.)`;
  let userLevel = "junior";
  let techFocus = "general";
  try {
    const { serverGetUserProfile } = await import("@/lib/server-firestore");
    const profile = await serverGetUserProfile(userId);
    if (profile?.profile?.level) userLevel = profile.profile.level;
    if (profile?.profile?.techFocus) techFocus = profile.profile.techFocus;
  } catch {
    /* optional personalization */
  }

  let checkpoints: Checkpoint[];
  const apiKey = process.env.GROQ_API_KEY;

  if (apiKey?.trim()) {
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
      const client = new Groq({ apiKey });
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1000,
        temperature: 0.3,
      });

      const text = completion.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error("Empty response");

      const rawList = parseCheckpointsJson(text);
      if (rawList.length === 0) throw new Error("No checkpoints");
      checkpoints = rawList.map((r, i) => toCheckpoint(r, i));
    } catch {
      checkpoints = fallbackCheckpoints(goal);
    }
  } else {
    checkpoints = fallbackCheckpoints(goal);
  }

  const startedAt = new Date();

  let sessionId: string;
  try {
    const { serverCreateSession } = await import("@/lib/server-firestore");
    sessionId = await serverCreateSession({
      userId,
      videoId,
      videoTitle,
      goal,
      checkpoints,
      status: "active",
      startedAt,
      endedAt: null,
      totalWatchSeconds: 0,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to save session";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    await serverIncrementUsage(userId);
  } catch {
    /* usage increment failed — session still created */
  }

  return NextResponse.json({
    sessionId,
    checkpoints,
    transcript: chunked,
    transcriptUnavailable,
  });
}
