import {
  doc,
  getDoc,
  increment,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";

export type UserPlan = "free" | "pro";

export type UserUsage = {
  sessions_used: number;
  plan: UserPlan;
};

const USERS = "users";

function userRef(userId: string) {
  return doc(db, USERS, userId);
}

/**
 * Returns usage for a Clerk user id. Missing docs count as free with 0 sessions.
 */
export async function getUserUsage(userId: string): Promise<UserUsage> {
  const snap = await getDoc(userRef(userId));
  if (!snap.exists()) {
    return { sessions_used: 0, plan: "free" };
  }
  const d = snap.data() as Record<string, unknown>;
  const sessions_used =
    typeof d.sessions_used === "number" && Number.isFinite(d.sessions_used)
      ? Math.max(0, Math.floor(d.sessions_used))
      : 0;
  const plan: UserPlan = d.plan === "pro" ? "pro" : "free";
  return { sessions_used, plan };
}

/**
 * Increments sessions_used by 1 after a session is successfully created.
 */
export async function incrementUsage(userId: string): Promise<void> {
  const ref = userRef(userId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, { sessions_used: 1, plan: "free" as const });
    return;
  }
  await updateDoc(ref, { sessions_used: increment(1) });
}

/**
 * Pro users have unlimited sessions; free users may start while sessions_used &lt; 5.
 */
export async function canStartSession(userId: string): Promise<boolean> {
  const { plan, sessions_used } = await getUserUsage(userId);
  return plan === "pro" || sessions_used < 5;
}

/**
 * Marks the user as Pro (e.g. after successful Razorpay payment).
 */
export async function upgradeToPro(userId: string): Promise<void> {
  await setDoc(userRef(userId), { plan: "pro" as const }, { merge: true });
}
