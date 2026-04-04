import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

import type { UserLearningProfile } from "@/types";

export const dynamic = "force-dynamic";

function isAnswers(v: unknown): v is UserLearningProfile {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const stringKeys: (keyof UserLearningProfile)[] = [
    "level",
    "mediumTermGoal",
    "sessionLength",
    "techFocus",
    "noteStyle",
  ];
  const validStrings = stringKeys.every(
    (k) => typeof o[k] === "string" && String(o[k]).trim().length > 0,
  );
  const validPainPoints =
    Array.isArray(o.painPoints) &&
    o.painPoints.every((x) => typeof x === "string" && x.trim().length > 0);
  return validStrings && validPainPoints;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let profile: Awaited<ReturnType<typeof import("@/lib/server-firestore")["serverGetUserProfile"]>> | null =
    null;
  try {
    const { serverGetUserProfile } = await import("@/lib/server-firestore");
    profile = await serverGetUserProfile(userId);
  } catch {
    return NextResponse.json({
      completed: false,
      profile: null,
      warning: "onboarding_profile_unavailable",
    });
  }
  return NextResponse.json({
    completed: profile?.onboardingCompleted === true,
    profile: profile?.profile ?? null,
  });
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
    return NextResponse.json({ error: "Invalid profile answers" }, { status: 400 });
  }

  const trimmed: UserLearningProfile = {
    level: answers.level.trim() as UserLearningProfile["level"],
    mediumTermGoal: answers.mediumTermGoal.trim(),
    painPoints: answers.painPoints.map((x) => x.trim()).filter(Boolean),
    sessionLength: answers.sessionLength.trim() as UserLearningProfile["sessionLength"],
    techFocus: answers.techFocus.trim(),
    noteStyle: answers.noteStyle.trim(),
  };

  try {
    const { serverSaveOnboardingData } = await import("@/lib/server-firestore");
    await serverSaveOnboardingData(userId, trimmed);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to save onboarding";
    return NextResponse.json(
      {
        error:
          message || "Could not save onboarding. Check your Supabase credentials.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: true });
}
