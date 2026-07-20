import { getServerSupabase } from "@/lib/supabase-server";
import {
  rowToBookmark,
  rowToNote,
  rowToSession,
  rowToUserProfile,
  sessionToRow,
} from "@/lib/db-mappers";
import type { UserUsage } from "@/lib/usage";
import type {
  Bookmark,
  Note,
  Session,
  UserLearningProfile,
  UserProfileDoc,
} from "@/types";

function serverDb() {
  return getServerSupabase();
}

async function ensureUser(userId: string): Promise<void> {
  const { error } = await serverDb().from("users").upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function serverGetUserProfile(userId: string): Promise<UserProfileDoc | null> {
  const { data: row, error } = await serverDb().from("users").select("*").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return row ? rowToUserProfile(row) : null;
}

export async function serverSaveOnboardingData(userId: string, data: UserLearningProfile): Promise<void> {
  await ensureUser(userId);
  const { error } = await serverDb().from("users").update({
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
  }).eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function serverGetUserUsage(userId: string): Promise<UserUsage> {
  const { data: row, error } = await serverDb().from("users").select("sessions_used, plan").eq("id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return { sessions_used: 0, plan: "free" };
  return {
    sessions_used: typeof row.sessions_used === "number" && Number.isFinite(row.sessions_used)
      ? Math.max(0, Math.floor(row.sessions_used))
      : 0,
    plan: row.plan === "pro" ? "pro" : "free",
  };
}

/**
 * Temporary compatibility method. New session creation must use the database
 * admission RPC added by the production schema migration.
 */
export async function serverIncrementUsage(userId: string): Promise<void> {
  await ensureUser(userId);
  const usage = await serverGetUserUsage(userId);
  const { error } = await serverDb().from("users").update({ sessions_used: usage.sessions_used + 1 }).eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function serverUpgradeToPro(userId: string): Promise<void> {
  await ensureUser(userId);
  const { error } = await serverDb().from("users").update({ plan: "pro" as const }).eq("id", userId);
  if (error) throw new Error(error.message);
}

export async function serverCanStartSession(userId: string): Promise<boolean> {
  const { plan, sessions_used } = await serverGetUserUsage(userId);
  return plan === "pro" || sessions_used < 5;
}

export async function serverBeginLearningSession(data: Omit<Session, "id">, idempotencyKey: string): Promise<{ sessionId: string | null; outcome: "created" | "existing" | "limit_reached" }> {
  const { data: result, error } = await serverDb().rpc("begin_learning_session", {
    p_user_id: data.userId,
    p_video_id: data.videoId,
    p_video_title: data.videoTitle,
    p_goal: data.goal,
    p_checkpoints: data.checkpoints,
    p_started_at: data.startedAt.toISOString(),
    p_idempotency_key: idempotencyKey,
  }).single();
  if (error) throw new Error(error.message);
  const admission = result as { outcome?: unknown; session_id?: unknown } | null;
  const outcome = admission?.outcome;
  if (outcome !== "created" && outcome !== "existing" && outcome !== "limit_reached") {
    throw new Error("Unexpected session admission response");
  }
  return { sessionId: admission?.session_id ? String(admission.session_id) : null, outcome };
}

export async function serverCreateSession(data: Omit<Session, "id">): Promise<string> {
  await ensureUser(data.userId);
  const { data: row, error } = await serverDb().from("sessions").insert(sessionToRow(data)).select("id").single();
  if (error) throw new Error(error.message);
  return String(row.id);
}

export async function serverGetSession(sessionId: string): Promise<Session | null> {
  const { data: row, error } = await serverDb().from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) throw new Error(error.message);
  return row ? rowToSession(row) : null;
}

export async function serverGetSessionForUser(sessionId: string, userId: string): Promise<Session | null> {
  const { data: row, error } = await serverDb().from("sessions").select("*").eq("id", sessionId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return row ? rowToSession(row) : null;
}

export async function serverGetSessionsForUser(userId: string): Promise<Session[]> {
  const { data, error } = await serverDb()
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "paused"])
    .order("started_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToSession);
}

export async function serverUpdateSession(sessionId: string, data: Partial<Omit<Session, "id">>): Promise<void> {
  const payload = sessionToRow(data);
  if (Object.keys(payload).length === 0) return;
  const { error } = await serverDb().from("sessions").update(payload).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function serverUpdateSessionForUser(sessionId: string, userId: string, data: Partial<Omit<Session, "id">>): Promise<boolean> {
  const payload = sessionToRow(data);
  if (Object.keys(payload).length === 0) return true;
  const { data: row, error } = await serverDb().from("sessions").update(payload).eq("id", sessionId).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(row);
}

export async function serverAddNote(data: Omit<Note, "id">): Promise<string> {
  const { data: row, error } = await serverDb().from("notes").insert({
    session_id: data.sessionId,
    timestamp: data.timestamp,
    type: data.type,
    content: data.content,
    created_at: data.createdAt.toISOString(),
  }).select("id").single();
  if (error) throw new Error(error.message);
  return String(row.id);
}

export async function serverGetNotesForUser(sessionId: string, userId: string): Promise<Note[] | null> {
  if (!(await serverGetSessionForUser(sessionId, userId))) return null;
  const { data, error } = await serverDb().from("notes").select("*").eq("session_id", sessionId).order("timestamp", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToNote);
}

export async function serverUpdateNoteContentForUser(noteId: string, sessionId: string, userId: string, content: string): Promise<boolean> {
  if (!(await serverGetSessionForUser(sessionId, userId))) return false;
  const { data, error } = await serverDb().from("notes").update({ content }).eq("id", noteId).eq("session_id", sessionId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function serverGetBookmarksForUser(sessionId: string, userId: string): Promise<Bookmark[] | null> {
  if (!(await serverGetSessionForUser(sessionId, userId))) return null;
  const { data, error } = await serverDb().from("bookmarks").select("*").eq("session_id", sessionId).order("timestamp_seconds", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToBookmark);
}

export async function serverAddBookmarkForUser(userId: string, data: Omit<Bookmark, "id">): Promise<string | null> {
  if (!(await serverGetSessionForUser(data.sessionId, userId))) return null;
  const { data: row, error } = await serverDb().from("bookmarks").insert({
    session_id: data.sessionId,
    timestamp_seconds: data.timestampSeconds,
    label: data.label,
    created_at: data.createdAt.toISOString(),
  }).select("id").single();
  if (error) throw new Error(error.message);
  return String(row.id);
}

export async function serverDeleteBookmarkForUser(bookmarkId: string, sessionId: string, userId: string): Promise<boolean> {
  if (!(await serverGetSessionForUser(sessionId, userId))) return false;
  const { data, error } = await serverDb().from("bookmarks").delete().eq("id", bookmarkId).eq("session_id", sessionId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function serverUpdateBookmarkLabelForUser(bookmarkId: string, sessionId: string, userId: string, label: string): Promise<boolean> {
  if (!(await serverGetSessionForUser(sessionId, userId))) return false;
  const { data, error } = await serverDb().from("bookmarks").update({ label }).eq("id", bookmarkId).eq("session_id", sessionId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export function isSupabaseServerConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}
