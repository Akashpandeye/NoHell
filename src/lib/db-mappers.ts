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

export function rowToSession(row: Row): Session {
  const checkpoints = row.checkpoints as Checkpoint[] | null;
  const recallQuestions = row.recall_questions as SessionRecallQuestion[] | null;
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
    recallQuestions: Array.isArray(recallQuestions) ? recallQuestions : undefined,
  };
}

export function sessionToRow(data: Partial<Omit<Session, "id">>): Row {
  const out: Row = {};
  if (data.userId !== undefined) out.user_id = data.userId;
  if (data.videoId !== undefined) out.video_id = data.videoId;
  if (data.videoTitle !== undefined) out.video_title = data.videoTitle;
  if (data.goal !== undefined) out.goal = data.goal;
  if (data.checkpoints !== undefined) out.checkpoints = data.checkpoints;
  if (data.status !== undefined) out.status = data.status;
  if (data.totalWatchSeconds !== undefined) out.total_watch_seconds = data.totalWatchSeconds;
  if (data.startedAt !== undefined) out.started_at = data.startedAt.toISOString();
  if (data.endedAt !== undefined) out.ended_at = data.endedAt?.toISOString() ?? null;
  if (data.recallQuestions !== undefined) out.recall_questions = data.recallQuestions;
  return out;
}

export function rowToNote(row: Row): Note {
  return {
    id: String(row.id),
    sessionId: String(row.session_id ?? ""),
    timestamp: Number(row.timestamp ?? 0),
    type: String(row.type) as Note["type"],
    content: String(row.content ?? ""),
    createdAt: row.created_at ? new Date(String(row.created_at)) : new Date(0),
  };
}

export function rowToBookmark(row: Row): Bookmark {
  return {
    id: String(row.id),
    sessionId: String(row.session_id ?? ""),
    timestampSeconds: Number(row.timestamp_seconds ?? 0),
    label: String(row.label ?? ""),
    createdAt: row.created_at ? new Date(String(row.created_at)) : new Date(0),
  };
}

export function rowToUserProfile(row: Row): UserProfileDoc {
  const profileRaw = row.profile as Record<string, unknown> | null;
  const onboardingCompleted = typeof row.onboarding_completed === "boolean" ? row.onboarding_completed : undefined;
  const onboardingCompletedAt = row.onboarding_completed_at ? new Date(String(row.onboarding_completed_at)) : null;

  let profile: UserLearningProfile | undefined;
  if (profileRaw && typeof profileRaw === "object") {
    profile = {
      level: String(profileRaw.level ?? "") as UserLearningProfile["level"],
      mediumTermGoal: String(profileRaw.mediumTermGoal ?? ""),
      painPoints: Array.isArray(profileRaw.painPoints)
        ? profileRaw.painPoints.map(String).filter((value) => value.trim().length > 0)
        : [],
      sessionLength: String(profileRaw.sessionLength ?? "") as UserLearningProfile["sessionLength"],
      techFocus: String(profileRaw.techFocus ?? ""),
      noteStyle: String(profileRaw.noteStyle ?? ""),
    };
  }

  return {
    onboardingCompleted,
    onboardingCompletedAt,
    profile,
    sessions_used: typeof row.sessions_used === "number" ? Number(row.sessions_used) : undefined,
    plan: row.plan === "pro" ? "pro" : row.plan === "free" ? "free" : undefined,
  };
}
