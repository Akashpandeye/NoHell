import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

import type { Note, NoteType } from "@/types";

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT =
  "You are a learning assistant for junior developers. Respond ONLY in valid JSON. No markdown.";

const NOTE_TYPES: ReadonlySet<string> = new Set([
  "concept",
  "code",
  "tip",
  "warning",
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

function parseNoteTimestamp(value: unknown, fallbackSeconds: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d+$/.test(t)) {
      const n = Number.parseInt(t, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return parseClockToSeconds(t);
  }
  return fallbackSeconds;
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

  if (!chunk || !sessionId) {
    return NextResponse.json(
      { error: "chunk and sessionId are required" },
      { status: 400 },
    );
  }

  const baseSeconds = parseClockToSeconds(timestampFormatted);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "Anthropic API is not configured" },
      { status: 503 },
    );
  }

  const userPrompt = `Extract 1-2 key learning points worth noting from this coding 
tutorial transcript segment. Skip filler, intros, and repetition. 
Only note things a junior dev should write down.
TRANSCRIPT: ${chunk}
Return ONLY: {notes:[{timestamp,type,content}]}
Types allowed: concept, code, tip, warning
If nothing valuable: {notes:[]}`;

  let rawNotes: Array<{ timestamp?: unknown; type?: unknown; content?: unknown }>;
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
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

    const parsed = parseNotesResponseJson(block.text) as {
      notes?: unknown;
    };
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
    const message = e instanceof Error ? e.message : "Claude request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const createdAt = new Date();
  const { addNote } = await import("@/lib/firestore");

  const saved: Note[] = [];

  for (const raw of rawNotes) {
    if (typeof raw !== "object" || raw === null) continue;
    const content =
      typeof raw.content === "string" ? raw.content.trim() : "";
    if (!content) continue;

    const type = normalizeNoteType(raw.type);
    if (!type) continue;

    const timestamp = parseNoteTimestamp(raw.timestamp, baseSeconds);

    try {
      const id = await addNote({
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
