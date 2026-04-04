import { supabase } from "@/lib/supabase";
import type {
  Bookmark,
  Checkpoint,
  Note,
  Session,
  SessionRecallQuestion,
  SessionStatus,
  UserLearningProfile,
  UserProfileDoc,
} from "@/types";

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Row ↔ domain mappers (exported so server-firestore.ts can reuse them)
// ---------------------------------------------------------------------------

export function rowToSession(row: Row): Session {
  const checkpoints = row.checkpoints as Checkpoint[] | null;
  const rq = row.recall_questions as SessionRecallQuestion[] | null;
  return {
    id: String(row.id),
    userId: String(row.user_id ?? ""),
    videoId: String(row.video_id ?? ""),
    videoTitle: String(row.video_title ?? ""),
    goal: String(row.goal ?? ""),
    checkpoints: Array.isArray(checkpoints) ? checkpoints : [],
    startedAt: row.started_at ? new Date(String(row.started_at)) : new Date(0),
    endedAt: row.ended_at ? new Date(String(row.ended_at)) : null,
    status: (String(row.status) as SessionStatus) ?? "active",
    totalWatchSeconds: Number(row.total_watch_seconds ?? 0),
    recallQuestions: Array.isArray(rq) ? rq : undefined,
  };
}

export function sessionToRow(
  data: Partial<Omit<Session, "id">>,
): Row {
  const out: Row = {};
  if (data.userId !== undefined) out.user_id = data.userId;
  if (data.videoId !== undefined) out.video_id = data.videoId;
  if (data.videoTitle !== undefined) out.video_title = data.videoTitle;
  if (data.goal !== undefined) out.goal = data.goal;
  if (data.checkpoints !== undefined) out.checkpoints = data.checkpoints;
  if (data.status !== undefined) out.status = data.status;
  if (data.totalWatchSeconds !== undefined)
    out.total_watch_seconds = data.totalWatchSeconds;
  if (data.startedAt !== undefined)
    out.started_at = data.startedAt.toISOString();
  if (data.endedAt !== undefined)
    out.ended_at = data.endedAt?.toISOString() ?? null;
  if (data.recallQuestions !== undefined)
    out.recall_questions = data.recallQuestions;
  return out;
}

function rowToNote(row: Row): Note {
  return {
    id: String(row.id),
    sessionId: String(row.session_id ?? ""),
    timestamp: Number(row.timestamp ?? 0),
    type: String(row.type) as Note["type"],
    content: String(row.content ?? ""),
    createdAt: row.created_at
      ? new Date(String(row.created_at))
      : new Date(0),
  };
}

function rowToBookmark(row: Row): Bookmark {
  return {
    id: String(row.id),
    sessionId: String(row.session_id ?? ""),
    timestampSeconds: Number(row.timestamp_seconds ?? 0),
    label: String(row.label ?? ""),
    createdAt: row.created_at
      ? new Date(String(row.created_at))
      : new Date(0),
  };
}

export function rowToUserProfile(row: Row): UserProfileDoc {
  const profileRaw = row.profile as Record<string, unknown> | null;
  const onboardingCompleted =
    typeof row.onboarding_completed === "boolean"
      ? row.onboarding_completed
      : undefined;
  const onboardingCompletedAt = row.onboarding_completed_at
    ? new Date(String(row.onboarding_completed_at))
    : null;

  let profile: UserLearningProfile | undefined;
  if (profileRaw && typeof profileRaw === "object") {
    const painPoints = Array.isArray(profileRaw.painPoints)
      ? profileRaw.painPoints
          .map((x) => String(x))
          .filter((x) => x.trim().length > 0)
      : [];
    profile = {
      level: String(profileRaw.level ?? "") as UserLearningProfile["level"],
      mediumTermGoal: String(profileRaw.mediumTermGoal ?? ""),
      painPoints,
      sessionLength: String(
        profileRaw.sessionLength ?? "",
      ) as UserLearningProfile["sessionLength"],
      techFocus: String(profileRaw.techFocus ?? ""),
      noteStyle: String(profileRaw.noteStyle ?? ""),
    };
  }

  return {
    onboardingCompleted,
    onboardingCompletedAt,
    profile,
    sessions_used:
      typeof row.sessions_used === "number"
        ? Number(row.sessions_used)
        : undefined,
    plan: row.plan === "pro" ? "pro" : row.plan === "free" ? "free" : undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API — same signatures as the previous Firestore implementation
// ---------------------------------------------------------------------------

export async function createSession(
  data: Omit<Session, "id">,
): Promise<string> {
  const { data: row, error } = await supabase
    .from("sessions")
    .insert(sessionToRow(data))
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(row!.id);
}

export async function getSession(
  sessionId: string,
): Promise<Session | null> {
  const { data: row, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  return rowToSession(row);
}

export async function updateSession(
  sessionId: string,
  data: Partial<Omit<Session, "id">>,
): Promise<void> {
  const payload = sessionToRow(data);
  if (Object.keys(payload).length === 0) return;
  const { error } = await supabase
    .from("sessions")
    .update(payload)
    .eq("id", sessionId);
  if (error) throw new Error(error.message);
}

export async function addNote(data: Omit<Note, "id">): Promise<string> {
  const { data: row, error } = await supabase
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

export async function getNotes(sessionId: string): Promise<Note[]> {
  const { data: rows, error } = await supabase
    .from("notes")
    .select("*")
    .eq("session_id", sessionId)
    .order("timestamp", { ascending: true });
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r) => rowToNote(r));
}

export async function addBookmark(
  data: Omit<Bookmark, "id">,
): Promise<string> {
  const { data: row, error } = await supabase
    .from("bookmarks")
    .insert({
      session_id: data.sessionId,
      timestamp_seconds: data.timestampSeconds,
      label: data.label,
      created_at: data.createdAt.toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return String(row!.id);
}

export async function getBookmarks(sessionId: string): Promise<Bookmark[]> {
  const { data: rows, error } = await supabase
    .from("bookmarks")
    .select("*")
    .eq("session_id", sessionId)
    .order("timestamp_seconds", { ascending: true });
  if (error) throw new Error(error.message);
  return (rows ?? []).map((r) => rowToBookmark(r));
}

export async function deleteBookmark(bookmarkId: string): Promise<void> {
  const { error } = await supabase.from("bookmarks").delete().eq("id", bookmarkId);
  if (error) throw new Error(error.message);
}

export async function updateBookmarkLabel(
  bookmarkId: string,
  label: string,
): Promise<void> {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Label cannot be empty");
  const { error } = await supabase
    .from("bookmarks")
    .update({ label: trimmed })
    .eq("id", bookmarkId);
  if (error) throw new Error(error.message);
}

export async function getUserProfile(
  userId: string,
): Promise<UserProfileDoc | null> {
  const { data: row, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  return rowToUserProfile(row);
}

export async function saveOnboardingData(
  userId: string,
  data: UserLearningProfile,
): Promise<void> {
  const { error } = await supabase.from("users").upsert({
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
}
