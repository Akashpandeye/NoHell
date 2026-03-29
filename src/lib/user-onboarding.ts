import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";

import { db } from "@/lib/firebase";

const USERS = "users";

/** Six onboarding fields saved on `users/{userId}`. */
export type OnboardingAnswers = {
  /** Q1 */
  role: string;
  /** Q2 */
  stackFocus: string;
  /** Q3 */
  learningStyle: string;
  /** Q4 */
  goalsThreeMonths: string;
  /** Q5 */
  hoursPerWeek: string;
  /** Q6 */
  tutorialFrustration: string;
};

export async function getOnboardingState(userId: string): Promise<{
  completed: boolean;
  answers: OnboardingAnswers | null;
}> {
  const snap = await getDoc(doc(db, USERS, userId));
  if (!snap.exists()) {
    return { completed: false, answers: null };
  }
  const d = snap.data() as Record<string, unknown>;
  const completed = d.onboardingCompleted === true;
  const raw = d.onboardingAnswers;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return { completed, answers: raw as OnboardingAnswers };
  }
  return { completed, answers: null };
}

export async function saveOnboarding(
  userId: string,
  answers: OnboardingAnswers,
): Promise<void> {
  await setDoc(
    doc(db, USERS, userId),
    {
      onboardingCompleted: true,
      onboardingAnswers: answers,
      onboardingCompletedAt: Timestamp.now(),
    },
    { merge: true },
  );
}
