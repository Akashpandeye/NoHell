import Groq from "groq-sdk";
import { NextRequest, NextResponse } from "next/server";

import type { SessionRecallQuestion } from "@/types";

export const dynamic = "force-dynamic";

const MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = "Respond ONLY in valid JSON.";

const NOTES_MAX_CHARS = 500;

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

function collectNoteStrings(notes: unknown): string[] {
  if (!Array.isArray(notes)) return [];
  const out: string[] = [];
  for (const n of notes) {
    if (typeof n === "string") {
      const t = n.trim();
      if (t) out.push(t);
    } else if (typeof n === "object" && n !== null && "content" in n) {
      const c = (n as { content?: unknown }).content;
      if (typeof c === "string" && c.trim()) out.push(c.trim());
    }
  }
  return out;
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
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const contents = collectNoteStrings(body.notes);
  const joined = contents.join(". ");
  const sessionNotesSlice =
    joined.length > NOTES_MAX_CHARS ? joined.slice(0, NOTES_MAX_CHARS) : joined;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey?.trim()) {
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
    const client = new Groq({ apiKey });
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1200,
      temperature: 0.3,
    });

    const text = completion.choices?.[0]?.message?.content ?? "";
    if (!text) {
      return NextResponse.json(
        { error: "Empty response from model" },
        { status: 502 },
      );
    }

    const parsed = parseRecallJson(text);
    recall_questions = normalizeRecallQuestions(parsed);
  } catch (e) {
    const message = e instanceof Error ? e.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  try {
    const { serverUpdateSession } = await import("@/lib/server-firestore");
    await serverUpdateSession(sessionId, { recallQuestions: recall_questions });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to save recall questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ recall_questions });
}
