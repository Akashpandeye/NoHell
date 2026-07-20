import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import {
  completeWithOpenRouter,
  isOpenRouterConfigured,
} from "@/lib/ai/openrouter";
import { isUuid } from "@/lib/server/authz";
import type {
  TutorialQuiz,
  TutorialRevisionCard,
  TutorialRevisionConcept,
} from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM_PROMPT =
  "You are a precise learning assistant for junior developers. Use only the supplied tutorial transcript. Respond ONLY in valid JSON with no markdown.";

const REQUEST_MAX_CHARS = 30_000;
const PROMPT_MAX_CHARS = 16_000;

type Body = {
  cumulativeText?: string;
  sessionId?: string;
  timeRange?: string;
};

function parseRevisionJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse(fenced ? fenced[1]!.trim() : trimmed) as unknown;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function cleanString(value: unknown, maxLength = 4_000): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanStringArray(
  value: unknown,
  maxItems: number,
  maxLength = 1_000,
): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of value) {
    const item = cleanString(raw, maxLength);
    const key = item.toLowerCase().replace(/\s+/g, " ");
    if (!item || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= maxItems) break;
  }
  return items;
}

function normalizeForEvidence(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9+#.'_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeConcepts(value: unknown): TutorialRevisionConcept[] {
  if (!Array.isArray(value)) return [];
  const concepts: TutorialRevisionConcept[] = [];
  for (const raw of value.slice(0, 5)) {
    const item = asObject(raw);
    if (!item) continue;
    const concept = {
      name: cleanString(item.name, 160),
      explanation: cleanString(item.explanation ?? item.what, 1_500),
      whyItMatters: cleanString(item.why_it_matters ?? item.why, 1_000),
      example: cleanString(item.example ?? item.analogy, 1_500),
      pitfall: cleanString(item.pitfall, 1_000),
    };
    if (!concept.name || !concept.explanation) continue;
    concepts.push(concept);
  }
  return concepts;
}

function normalizeQuiz(value: unknown, transcript: string): TutorialQuiz | undefined {
  const quiz = asObject(value);
  if (!quiz) return undefined;

  const question = cleanString(quiz.question, 600);
  const correctOptionId = cleanString(
    quiz.correct_option_id ?? quiz.correctOptionId,
    40,
  );
  const explanation = cleanString(quiz.explanation, 1_200);
  const evidenceQuote = cleanString(
    quiz.evidence_quote ?? quiz.evidenceQuote,
    500,
  );
  const optionsRaw = Array.isArray(quiz.options) ? quiz.options.slice(0, 4) : [];
  const options: TutorialQuiz["options"] = [];
  const optionIds = new Set<string>();
  const optionTexts = new Set<string>();

  for (const raw of optionsRaw) {
    const option = asObject(raw);
    if (!option) continue;
    const id = cleanString(option.id, 40);
    const text = cleanString(option.text, 500);
    const normalizedText = text.toLowerCase().replace(/\s+/g, " ");
    if (!id || !text || optionIds.has(id) || optionTexts.has(normalizedText)) {
      continue;
    }
    optionIds.add(id);
    optionTexts.add(normalizedText);
    options.push({ id, text });
  }

  const normalizedEvidence = normalizeForEvidence(evidenceQuote);
  const normalizedTranscript = normalizeForEvidence(transcript);
  if (
    !question ||
    !explanation ||
    !correctOptionId ||
    options.length < 3 ||
    options.length > 4 ||
    !optionIds.has(correctOptionId) ||
    normalizedEvidence.length < 12 ||
    !normalizedTranscript.includes(normalizedEvidence)
  ) {
    return undefined;
  }

  return { question, options, correctOptionId, explanation };
}

function normalizeRevisionCard(
  raw: unknown,
  transcript: string,
  fallbackTimeRange: string,
): TutorialRevisionCard | null {
  const root = asObject(raw);
  const revision = asObject(root?.revision_card);
  if (!revision) return null;

  const overview = cleanString(revision.overview, 1_500);
  const concepts = normalizeConcepts(revision.concepts);
  if (!overview && concepts.length === 0) return null;

  const recallRaw = asObject(revision.recall);
  const card: TutorialRevisionCard = {
    timeRange:
      cleanString(revision.time_range ?? revision.timeRange, 120) ||
      fallbackTimeRange ||
      "—",
    overview,
    keyTakeaways: cleanStringArray(
      revision.key_takeaways ?? revision.keyTakeaways,
      7,
    ),
    concepts,
    processSteps: cleanStringArray(
      revision.process_steps ?? revision.processSteps,
      8,
    ),
    codeSkeleton: cleanString(
      revision.code_skeleton ?? revision.codeSkeleton,
      6_000,
    ),
    codeWalkthrough: cleanStringArray(
      revision.code_walkthrough ?? revision.codeWalkthrough,
      8,
    ),
    connections: cleanStringArray(revision.connections, 5),
    recall: {
      question: cleanString(
        recallRaw?.question ?? revision.recall_question,
        800,
      ),
      hint: cleanString(recallRaw?.hint, 800),
      answer: cleanString(recallRaw?.answer, 1_500),
    },
  };

  const quiz = normalizeQuiz(revision.quiz, transcript);
  if (quiz) card.quiz = quiz;
  return card;
}

function transcriptForPrompt(value: string): string {
  if (value.length <= PROMPT_MAX_CHARS) return value;
  const half = Math.floor(PROMPT_MAX_CHARS / 2);
  return `${value.slice(0, half)}\n\n[...middle omitted for length...]\n\n${value.slice(-half)}`;
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cumulativeText =
    typeof body.cumulativeText === "string" ? body.cumulativeText.trim() : "";
  const sessionId =
    typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  const timeRange =
    typeof body.timeRange === "string" ? body.timeRange.trim() : "";

  if (
    !isUuid(sessionId) ||
    !cumulativeText ||
    cumulativeText.length > REQUEST_MAX_CHARS
  ) {
    return NextResponse.json(
      {
        error:
          "A valid sessionId and content of up to 30,000 characters are required",
      },
      { status: 400 },
    );
  }

  const { serverGetSessionForUser } = await import("@/lib/server-firestore");
  if (!(await serverGetSessionForUser(sessionId, userId))) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!isOpenRouterConfigured()) {
    return NextResponse.json(
      { error: "AI API is not configured" },
      { status: 503 },
    );
  }

  const transcript = transcriptForPrompt(cumulativeText);
  const userPrompt = `Create a comprehensive revision card for a junior developer who just watched this three-minute tutorial section.

TIME RANGE: ${timeRange || "—"}
TRANSCRIPT:
${transcript}

Use only facts explicitly supported by the transcript. Skip fields that are not relevant instead of inventing content.
Return ONLY this JSON shape:
{
  "revision_card": {
    "time_range": "${timeRange || "—"}",
    "overview": "short explanation of what this section taught",
    "key_takeaways": ["4-7 concise takeaways"],
    "concepts": [
      {
        "name": "concept name",
        "explanation": "clear explanation",
        "why_it_matters": "practical importance",
        "example": "concrete example from or directly supported by the transcript",
        "pitfall": "common mistake, or empty string if unsupported"
      }
    ],
    "process_steps": ["ordered steps only when the transcript presents a process"],
    "code_skeleton": "code or pseudocode only when code/syntax is discussed, otherwise empty string",
    "code_walkthrough": ["short explanation of important code blocks, otherwise []"],
    "connections": ["links to related concepts explicitly mentioned or directly established"],
    "recall": {
      "question": "one useful open-ended recall question",
      "hint": "small hint",
      "answer": "expected answer grounded in the transcript"
    },
    "quiz": null
  }
}

Generate 2-5 concepts. For quiz, replace null with exactly one object only when the transcript supports one unambiguous multiple-choice question with exactly one correct answer:
{
  "question": "...",
  "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."}],
  "correct_option_id": "A",
  "explanation": "why the answer is correct",
  "evidence_quote": "an exact short quote copied from the transcript that proves the answer"
}
Keep quiz null for introductions, opinions, ambiguous explanations, or questions requiring outside knowledge.`;

  try {
    const text = await completeWithOpenRouter(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 4096, temperature: 0.2 },
    );

    const revisionCard = normalizeRevisionCard(
      parseRevisionJson(text),
      cumulativeText,
      timeRange,
    );
    if (!revisionCard) {
      return NextResponse.json(
        { error: "Invalid revision card from model" },
        { status: 502 },
      );
    }

    return NextResponse.json({ revision_card: revisionCard });
  } catch (error) {
    console.error(
      "Revision card generation failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return NextResponse.json(
      { error: "Could not generate revision card" },
      { status: 502 },
    );
  }
}
