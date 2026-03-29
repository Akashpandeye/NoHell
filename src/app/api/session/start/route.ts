import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

import {
  splitTranscriptByTime,
  type TranscriptChunk,
  type TranscriptLine,
} from "@/lib/transcript";
import type { Checkpoint } from "@/types";

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-20250514";
const SYSTEM_PROMPT =
  "You are a learning assistant for junior developers. Respond ONLY in valid JSON. No markdown, no text outside the JSON.";

type StartBody = {
  videoId?: string;
  goal?: string;
  userId?: string;
};

type ClaudeCheckpointRaw = {
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

function parseClaudeCheckpointsJson(text: string): ClaudeCheckpointRaw[] {
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
  return (parsed as { checkpoints: ClaudeCheckpointRaw[] }).checkpoints;
}

function toCheckpoint(raw: ClaudeCheckpointRaw, index: number): Checkpoint {
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

async function fetchYouTubeTitle(videoId: string): Promise<string> {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  try {
    const res = await fetch(oembedUrl, { next: { revalidate: 86400 } });
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

  const { canStartSession, incrementUsage } = await import("@/lib/usage");
  const allowed = await canStartSession(userId);
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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "Anthropic API is not configured" },
      { status: 503 },
    );
  }

  const origin = request.nextUrl.origin;
  let transcript: TranscriptLine[];
  try {
    const tRes = await fetch(
      `${origin}/api/transcript?videoId=${encodeURIComponent(videoId)}`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
    if (!tRes.ok) {
      const err = await tRes.json().catch(() => ({}));
      const status = tRes.status === 404 ? 404 : 502;
      return NextResponse.json(
        {
          error:
            typeof err === "object" && err && "error" in err
              ? (err as { error: string }).error
              : "Transcript unavailable",
        },
        { status },
      );
    }
    transcript = (await tRes.json()) as TranscriptLine[];
    if (!Array.isArray(transcript)) {
      return NextResponse.json(
        { error: "Transcript unavailable" },
        { status: 404 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch transcript" },
      { status: 502 },
    );
  }

  const chunked: TranscriptChunk[] = splitTranscriptByTime(transcript, 5);
  const preview = firstNWordsFromTranscript(transcript, 500);

  const userPrompt = `Break this learning goal into 3-5 checkpoints for this coding tutorial.
GOAL: ${goal}
TRANSCRIPT_PREVIEW: ${preview}
Return ONLY: {checkpoints:[{id,title,description,estimated_minute}]}`;

  let checkpoints: Checkpoint[];
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      return NextResponse.json(
        { error: "Empty response from model" },
        { status: 502 },
      );
    }

    const rawList = parseClaudeCheckpointsJson(block.text);
    if (rawList.length === 0) {
      return NextResponse.json(
        { error: "No checkpoints returned from model" },
        { status: 502 },
      );
    }
    checkpoints = rawList.map((r, i) => toCheckpoint(r, i));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Claude request failed";
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }

  const videoTitle = await fetchYouTubeTitle(videoId);
  const startedAt = new Date();

  let sessionId: string;
  try {
    const { createSession } = await import("@/lib/firestore");
    sessionId = await createSession({
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
    await incrementUsage(userId);
  } catch {
    /* usage increment failed — session still created */
  }

  return NextResponse.json({
    sessionId,
    checkpoints,
    transcript: chunked,
  });
}
