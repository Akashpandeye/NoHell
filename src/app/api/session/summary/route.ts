import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import {
  completeWithOpenRouter,
  isOpenRouterConfigured,
} from "@/lib/ai/openrouter";
import { isUuid } from "@/lib/server/authz";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type SummaryBody = {
  sessionId?: string;
  transcript?: string;
};

type SummaryPoint = {
  timestamp: number;
  points: string[];
};

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1]!.trim() : trimmed) as unknown;
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value !== "string") return null;
  const parts = value.trim().split(":");
  if (parts.length !== 2) return null;
  const minutes = Number.parseInt(parts[0]!, 10);
  const seconds = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) {
    return null;
  }
  return Math.max(0, minutes * 60 + seconds);
}

function normalizeSummary(raw: unknown): SummaryPoint[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const pointsRaw = (raw as { points?: unknown }).points;
  if (!Array.isArray(pointsRaw)) return null;

  const points: SummaryPoint[] = [];
  for (const item of pointsRaw.slice(0, 12)) {
    if (typeof item !== "object" || item === null) continue;
    const value = item as { timestamp?: unknown; points?: unknown };
    const timestamp = parseTimestamp(value.timestamp);
    const bullets = Array.isArray(value.points)
      ? value.points.filter((point): point is string => typeof point === "string")
          .map((point) => point.trim())
          .filter(Boolean)
          .slice(0, 4)
      : [];
    if (timestamp === null || bullets.length === 0) continue;
    points.push({ timestamp, points: bullets });
  }
  return points;
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: SummaryBody;
  try {
    body = (await request.json()) as SummaryBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!isUuid(sessionId) || !transcript || transcript.length > 30_000) {
    return NextResponse.json(
      { error: "A valid sessionId and watched transcript are required" },
      { status: 400 },
    );
  }

  const { serverGetSessionForUser } = await import("@/lib/server-firestore");
  if (!(await serverGetSessionForUser(sessionId, userId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!isOpenRouterConfigured()) {
    return NextResponse.json({ error: "AI API is not configured" }, { status: 503 });
  }

  const prompt = `Summarize only the watched portion of this coding tutorial into concise study notes.
Each transcript line begins with an exact timestamp in [MM:SS] format. Reuse those timestamps exactly.
Return 4-12 timestamped note cards. Each card must contain 1-3 short bullet points.
Do not add concepts that are not in the transcript.
Return ONLY: {points:[{timestamp,points:[string]}]}
WATCHED TRANSCRIPT:
${transcript}`;

  try {
    const text = await completeWithOpenRouter([
      { role: "system", content: "Respond ONLY in valid JSON. No markdown." },
      { role: "user", content: prompt },
    ], { maxTokens: 1800, temperature: 0.2 });
    const summary = normalizeSummary(parseJson(text));
    if (!summary) {
      return NextResponse.json({ error: "Invalid summary shape from model" }, { status: 502 });
    }
    return NextResponse.json({ summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
