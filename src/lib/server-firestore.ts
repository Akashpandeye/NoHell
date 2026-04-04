import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerSupabase } from "@/lib/supabase-server";
import {
  rowToSession,
  rowToUserProfile,
  sessionToRow,
} from "@/lib/firestore";
import type { UserPlan, UserUsage } from "@/lib/usage";
import type {
  Note,
  Session,
  UserLearningProfile,
  UserProfileDoc,
} from "@/types";

function serverDb(): SupabaseClient | null {
  return getServerSupabase();
}

// ---------------------------------------------------------------------------
// Public: prefer server client (service-role key) in API routes;
// fall back to the client-side module when the key is not set.
// ---------------------------------------------------------------------------

export async function serverGetUserProfile(
  userId: string,
): Promise<UserProfileDoc | null> {
  const sb = serverDb();
  if (sb) {
    const { data: row, error } = await sb
      .from("users")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return rowToUserProfile(row);
  }
  const { getUserProfile } = await import("@/lib/firestore");
  return getUserProfile(userId);
}

export async function serverSaveOnboardingData(
  userId: string,
  data: UserLearningProfile,
): Promise<void> {
  const sb = serverDb();
  if (sb) {
    const { error } = await sb.from("users").upsert({
      id: userId,
      onboarding_completed: true,
      onboarding_completed_at: new Date().toISOString(),
      profile: {
        level: data.level,
        mediumTermGoal: data.mediumTermGoal,
        painPoints: data.painPoints,
        sessionLength: data.sessionLength,
        techFocus: data.techFocus,
        noteStyle: data.noteStyle,
      },
    });
    if (error) throw new Error(error.message);
    return;
  }
  const { saveOnboardingData } = await import("@/lib/firestore");
  return saveOnboardingData(userId, data);
}

export async function serverGetUserUsage(
  userId: string,
): Promise<UserUsage> {
  const sb = serverDb();
  if (sb) {
    const { data: row, error } = await sb
      .from("users")
      .select("sessions_used, plan")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return { sessions_used: 0, plan: "free" };
    const sessions_used =
      typeof row.sessions_used === "number" &&
      Number.isFinite(row.sessions_used)
        ? Math.max(0, Math.floor(row.sessions_used))
        : 0;
    const plan: UserPlan = row.plan === "pro" ? "pro" : "free";
    return { sessions_used, plan };
  }
  const { getUserUsage } = await import("@/lib/usage");
  return getUserUsage(userId);
}

export async function serverIncrementUsage(
  userId: string,
): Promise<void> {
  const sb = serverDb();
  if (sb) {
    const { data: row } = await sb
      .from("users")
      .select("sessions_used")
      .eq("id", userId)
      .maybeSingle();
    if (!row) {
      const { error } = await sb
        .from("users")
        .insert({ id: userId, sessions_used: 1, plan: "free" });
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await sb
      .from("users")
      .update({ sessions_used: (row.sessions_used ?? 0) + 1 })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return;
  }
  const { incrementUsage } = await import("@/lib/usage");
  return incrementUsage(userId);
}

export async function serverUpgradeToPro(
  userId: string,
): Promise<void> {
  const sb = serverDb();
  if (sb) {
    const { error } = await sb
      .from("users")
      .upsert({ id: userId, plan: "pro" as const });
    if (error) throw new Error(error.message);
    return;
  }
  const { upgradeToPro } = await import("@/lib/usage");
  return upgradeToPro(userId);
}

export async function serverCanStartSession(
  userId: string,
): Promise<boolean> {
  const { plan, sessions_used } = await serverGetUserUsage(userId);
  return plan === "pro" || sessions_used < 5;
}

export async function serverCreateSession(
  data: Omit<Session, "id">,
): Promise<string> {
  const sb = serverDb();
  if (sb) {
    const { data: row, error } = await sb
      .from("sessions")
      .insert(sessionToRow(data))
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return String(row!.id);
  }
  const { createSession } = await import("@/lib/firestore");
  return createSession(data);
}

export async function serverGetSession(
  sessionId: string,
): Promise<Session | null> {
  const sb = serverDb();
  if (sb) {
    const { data: row, error } = await sb
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return rowToSession(row);
  }
  const { getSession } = await import("@/lib/firestore");
  return getSession(sessionId);
}

export async function serverUpdateSession(
  sessionId: string,
  data: Partial<Omit<Session, "id">>,
): Promise<void> {
  const sb = serverDb();
  if (sb) {
    const payload = sessionToRow(data);
    if (Object.keys(payload).length === 0) return;
    const { error } = await sb
      .from("sessions")
      .update(payload)
      .eq("id", sessionId);
    if (error) throw new Error(error.message);
    return;
  }
  const { updateSession } = await import("@/lib/firestore");
  return updateSession(sessionId, data);
}

export async function serverAddNote(
  data: Omit<Note, "id">,
): Promise<string> {
  const sb = serverDb();
  if (sb) {
    const { data: row, error } = await sb
      .from("notes")
      .insert({
        session_id: data.sessionId,
        timestamp: data.timestamp,
        type: data.type,
        content: data.content,
        created_at: data.createdAt.toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return String(row!.id);
  }
  const { addNote } = await import("@/lib/firestore");
  return addNote(data);
}

/** True when `SUPABASE_SERVICE_ROLE_KEY` is set and the server client is active. */
export function isSupabaseServerConfigured(): boolean {
  return serverDb() !== null;
}
