import { supabase } from "@/lib/supabase";

/** Six onboarding fields saved on `users`. */
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
  const { data: row, error } = await supabase
    .from("users")
    .select("onboarding_completed, onboarding_answers")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { completed: false, answers: null };

  const completed = row.onboarding_completed === true;
  const raw = row.onboarding_answers;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return { completed, answers: raw as OnboardingAnswers };
  }
  return { completed, answers: null };
}

export async function saveOnboarding(
  userId: string,
  answers: OnboardingAnswers,
): Promise<void> {
  const { error } = await supabase.from("users").upsert({
    id: userId,
    onboarding_completed: true,
    onboarding_answers: answers,
    onboarding_completed_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}
