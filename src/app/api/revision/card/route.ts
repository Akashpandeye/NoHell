import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

import type { TutorialRevisionCard } from "@/types";

export const dynamic = "force-dynamic";

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT =
  "You are a learning assistant for junior developers. Respond ONLY in valid JSON.";

const CONTENT_MAX_CHARS = 800;

type Body = {
  cumulativeText?: string;
  sessionId?: string;
  timeRange?: string;
};

function parseRevisionJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fenced ? fenced[1]!.trim() : trimmed;
  return JSON.parse(jsonStr) as unknown;
}

function normalizeRevisionCard(raw: unknown): TutorialRevisionCard | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const rc = o.revision_card;
  if (typeof rc !== "object" || rc === null) return null;
  const r = rc as Record<string, unknown>;

  const time_range =
    typeof r.time_range === "string" ? r.time_range.trim() : "";
  const code_skeleton =
    typeof r.code_skeleton === "string" ? r.code_skeleton : "";
  const recall_question =
    typeof r.recall_question === "string" ? r.recall_question.trim() : "";

  const conceptsRaw = r.concepts;
  const concepts: TutorialRevisionCard["concepts"] = [];
  if (Array.isArray(conceptsRaw)) {
    for (const c of conceptsRaw.slice(0, 5)) {
      if (typeof c !== "object" || c === null) continue;
      const x = c as Record<string, unknown>;
      const name = typeof x.name === "string" ? x.name.trim() : "";
      const what = typeof x.what === "string" ? x.what.trim() : "";
      const why = typeof x.why === "string" ? x.why.trim() : "";
      const analogy =
        typeof x.analogy === "string" ? x.analogy.trim() : "";
      if (!name && !what) continue;
      concepts.push({ name, what, why, analogy });
    }
  }

  if (!time_range && concepts.length === 0 && !code_skeleton && !recall_question) {
    return null;
  }

  return {
    time_range: time_range || "—",
    concepts,
    code_skeleton,
    recall_question,
  };
}

export async function POST(request: NextRequest) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cumulativeText =
    typeof body.cumulativeText === "string" ? body.cumulativeText : "";
  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const timeRange =
    typeof body.timeRange === "string" ? body.timeRange.trim() : "";

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  const slice =
    cumulativeText.length > CONTENT_MAX_CHARS
      ? cumulativeText.slice(0, CONTENT_MAX_CHARS)
      : cumulativeText;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey?.trim()) {
    return NextResponse.json(
      { error: "Anthropic API is not configured" },
      { status: 503 },
    );
  }

  const userPrompt = `Generate a revision card for a developer who just watched this 
section of a coding tutorial.
CONTENT: ${slice}
TIME RANGE: ${timeRange || "—"}
Return ONLY:
{revision_card:{
  time_range,
  concepts:[{name, what, why, analogy}],
  code_skeleton,
  recall_question
}}
Include 2-3 concepts max.`;

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
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

    const parsed = parseRevisionJson(block.text);
    const revision_card = normalizeRevisionCard(parsed);
    if (!revision_card) {
      return NextResponse.json(
        { error: "Invalid revision_card from model" },
        { status: 502 },
      );
    }

    return NextResponse.json({ revision_card });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Claude request failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
