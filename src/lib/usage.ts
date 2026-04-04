import { supabase } from "@/lib/supabase";

export type UserPlan = "free" | "pro";

export type UserUsage = {
  sessions_used: number;
  plan: UserPlan;
};

/**
 * Returns usage for a Clerk user id. Missing rows count as free with 0 sessions.
 */
export async function getUserUsage(userId: string): Promise<UserUsage> {
  const { data: row, error } = await supabase
    .from("users")
    .select("sessions_used, plan")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { sessions_used: 0, plan: "free" };
  const sessions_used =
    typeof row.sessions_used === "number" && Number.isFinite(row.sessions_used)
      ? Math.max(0, Math.floor(row.sessions_used))
      : 0;
  const plan: UserPlan = row.plan === "pro" ? "pro" : "free";
  return { sessions_used, plan };
}

/**
 * Increments sessions_used by 1 after a session is successfully created.
 */
export async function incrementUsage(userId: string): Promise<void> {
  const { data: row } = await supabase
    .from("users")
    .select("sessions_used")
    .eq("id", userId)
    .maybeSingle();

  if (!row) {
    const { error } = await supabase
      .from("users")
      .insert({ id: userId, sessions_used: 1, plan: "free" as const });
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("users")
    .update({ sessions_used: (row.sessions_used ?? 0) + 1 })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/**
 * Pro users have unlimited sessions; free users may start while sessions_used < 5.
 */
export async function canStartSession(userId: string): Promise<boolean> {
  const { plan, sessions_used } = await getUserUsage(userId);
  return plan === "pro" || sessions_used < 5;
}

/**
 * Marks the user as Pro (e.g. after successful Razorpay payment).
 */
export async function upgradeToPro(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .upsert({ id: userId, plan: "pro" as const });
  if (error) throw new Error(error.message);
}
