import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import type { OnboardingAnswers } from "@/lib/user-onboarding";

export const dynamic = "force-dynamic";

function isAnswers(v: unknown): v is OnboardingAnswers {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const keys: (keyof OnboardingAnswers)[] = [
    "role",
    "stackFocus",
    "learningStyle",
    "goalsThreeMonths",
    "hoursPerWeek",
    "tutorialFrustration",
  ];
  return keys.every((k) => typeof o[k] === "string" && String(o[k]).trim().length > 0);
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { getOnboardingState } = await import("@/lib/user-onboarding");
  const state = await getOnboardingState(userId);
  return NextResponse.json(state);
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const answers =
    typeof body === "object" &&
    body !== null &&
    "answers" in body &&
    (body as { answers: unknown }).answers;

  if (!isAnswers(answers)) {
    return NextResponse.json(
      { error: "Invalid answers: all six string fields required" },
      { status: 400 },
    );
  }

  const trimmed: OnboardingAnswers = {
    role: answers.role.trim(),
    stackFocus: answers.stackFocus.trim(),
    learningStyle: answers.learningStyle.trim(),
    goalsThreeMonths: answers.goalsThreeMonths.trim(),
    hoursPerWeek: answers.hoursPerWeek.trim(),
    tutorialFrustration: answers.tutorialFrustration.trim(),
  };

  try {
    const { saveOnboarding } = await import("@/lib/user-onboarding");
    await saveOnboarding(userId, trimmed);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to save onboarding";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
