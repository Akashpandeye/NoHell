import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import {
  completeWithOpenRouter,
  isOpenRouterConfigured,
} from "@/lib/ai/openrouter";
import { isUuid } from "@/lib/server/authz";
import type { Note, NoteType } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT =
  "You are a learning assistant for junior developers. Respond ONLY in valid JSON. No markdown.";

const NOTE_TYPES: ReadonlySet<string> = new Set([
  "theory",
  "important",
  "syntax",
  "logic",
]);

type GenerateBody = {
  chunk?: string;
  sessionId?: string;
  timestamp?: string;
};

function parseClockToSeconds(formatted: string): number {
  const s = formatted.trim();
  const parts = s.split(":");
  if (parts.length === 2) {
    const m = Number.parseInt(parts[0]!, 10);
    const sec = Number.parseInt(parts[1]!, 10);
    if (Number.isFinite(m) && Number.isFinite(sec)) return m * 60 + sec;
  }
  return 0;
}

function parseNotesResponseJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1]!.trim() : trimmed;
  return JSON.parse(jsonStr) as unknown;
}

function normalizeNoteType(raw: unknown): NoteType | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return NOTE_TYPES.has(t) ? (t as NoteType) : null;
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const chunk =
    typeof body.chunk === "string" ? body.chunk.trim() : "";
  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const timestampFormatted =
    typeof body.timestamp === "string" ? body.timestamp.trim() : "";

  if (!chunk || chunk.length > 20_000 || !isUuid(sessionId)) {
    return NextResponse.json(
      { error: "A valid sessionId and a transcript chunk of up to 20,000 characters are required" },
      { status: 400 },
    );
  }

  const { serverGetSessionForUser } = await import("@/lib/server-firestore");
  const session = await serverGetSessionForUser(sessionId, userId);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const baseSeconds = parseClockToSeconds(timestampFormatted);

  if (!isOpenRouterConfigured()) {
    return NextResponse.json(
      { error: "AI API is not configured" },
      { status: 503 },
    );
  }

  let userLevel = "junior";
  try {
    const { serverGetUserProfile } = await import("@/lib/server-firestore");
    const profile = await serverGetUserProfile(session.userId);
    if (profile?.profile?.level) userLevel = profile.profile.level;
  } catch {
    /* Optional personalization must not bypass owner authorization. */
  }

  const userPrompt = `Extract 2-4 key learning points from this coding tutorial transcript segment.
Skip filler, intros, and repetition. Only note things worth writing down.
Categorize each note into EXACTLY ONE type. Each point must appear in only one category — never duplicate across types:
- theory: detailed explanation of a concept, point-wise, with context and reasoning
- important: key takeaways the learner must remember (NOT theory reworded)
- syntax: code patterns, syntax rules, or API signatures with short examples (NOT theory about code)
- logic: step-by-step logical flow explained simply, with a concrete example (NOT theory restated)
RULE: If a point fits multiple categories, pick the MOST specific one. Never repeat the same idea in two notes.
TRANSCRIPT: ${chunk}
USER LEVEL: ${userLevel}
Adjust explanation depth accordingly.
For beginners explain every concept from scratch with simple analogies.
For juniors skip obvious basics and focus on nuance.
Write content as concise note-style bullets separated by newlines. Do not write an essay.
The segment starts at ${timestampFormatted || "00:00"}; do not invent timestamps.
Return ONLY: {notes:[{type,content}]}
If nothing valuable: {notes:[]}`;

  let rawNotes: Array<{ timestamp?: unknown; type?: unknown; content?: unknown }>;
  try {
    const text = await completeWithOpenRouter([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], { maxTokens: 1024, temperature: 0.3 });

    const parsed = parseNotesResponseJson(text) as { notes?: unknown };
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !Array.isArray(parsed.notes)
    ) {
      return NextResponse.json(
        { error: "Invalid JSON shape from model" },
        { status: 502 },
      );
    }
    rawNotes = parsed.notes as typeof rawNotes;
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const createdAt = new Date();
  const { serverAddNote } = await import("@/lib/server-firestore");

  const saved: Note[] = [];

  for (const raw of rawNotes) {
    if (typeof raw !== "object" || raw === null) continue;
    const content =
      typeof raw.content === "string" ? raw.content.trim() : "";
    if (!content) continue;

    const type = normalizeNoteType(raw.type);
    if (!type) continue;

    // The model receives transcript text, not timed caption lines. The segment
    // start is the only trustworthy timestamp for every note in this request.
    const timestamp = baseSeconds;

    try {
      const id = await serverAddNote({
        sessionId,
        timestamp,
        type,
        content,
        createdAt,
      });
      saved.push({
        id,
        sessionId,
        timestamp,
        type,
        content,
        createdAt,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save note";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  return NextResponse.json({ notes: saved });
}
