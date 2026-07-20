import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import {
  completeWithOpenRouter,
  isOpenRouterConfigured,
} from "@/lib/ai/openrouter";
import { isUuid } from "@/lib/server/authz";
import type { SessionRecallQuestion } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT = "Respond ONLY in valid JSON.";

const NOTES_MAX_CHARS = 8_000;

type Body = {
  sessionId?: string;
  notes?: unknown;
  goal?: string;
};

function parseRecallJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1]!.trim() : trimmed;
  return JSON.parse(jsonStr) as unknown;
}

function normalizeRecallQuestions(raw: unknown): SessionRecallQuestion[] {
  if (typeof raw !== "object" || raw === null) return [];
  const o = raw as Record<string, unknown>;
  const list = o.recall_questions;
  if (!Array.isArray(list)) return [];

  const out: SessionRecallQuestion[] = [];
  for (let i = 0; i < list.length && out.length < 6; i++) {
    const item = list[i];
    if (typeof item !== "object" || item === null) continue;
    const x = item as Record<string, unknown>;
    const id =
      typeof x.id === "string" && x.id.trim()
        ? x.id.trim()
        : `rq-${i + 1}`;
    const question =
      typeof x.question === "string" ? x.question.trim() : "";
    const hint = typeof x.hint === "string" ? x.hint.trim() : "";
    if (!question) continue;
    out.push({ id, question, hint });
  }
  return out.slice(0, 4);
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "A valid sessionId is required" }, { status: 400 });
  }

  const { serverGetNotesForUser, serverUpdateSessionForUser } = await import("@/lib/server-firestore");
  const notes = await serverGetNotesForUser(sessionId, userId);
  if (!notes) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const contents = notes.map((note) => note.content.trim()).filter(Boolean);
  const joined = contents.join("\n\n");
  const sessionNotesSlice = joined.length > NOTES_MAX_CHARS ? joined.slice(-NOTES_MAX_CHARS) : joined;

  if (!isOpenRouterConfigured()) {
    return NextResponse.json(
      { error: "AI API is not configured" },
      { status: 503 },
    );
  }

  const userPrompt = `Generate 4 open-ended recall questions for a junior developer 
who just finished watching a coding tutorial session.
SESSION NOTES: ${sessionNotesSlice}
Return ONLY: {recall_questions:[{id, question, hint}]}`;

  let recall_questions: SessionRecallQuestion[];
  try {
    const text = await completeWithOpenRouter([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ], { maxTokens: 1200, temperature: 0.3 });

    const parsed = parseRecallJson(text);
    recall_questions = normalizeRecallQuestions(parsed);
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    const updated = await serverUpdateSessionForUser(sessionId, userId, { recallQuestions: recall_questions });
    if (!updated) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to save recall questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ recall_questions });
}
