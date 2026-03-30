import {
  FieldValue,
  getFirestore,
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import { getFirebaseAdminApp } from "@/lib/firebase-admin-init";
import type { UserPlan, UserUsage } from "@/lib/usage";
import type {
  Checkpoint,
  Note,
  Session,
  SessionRecallQuestion,
  SessionStatus,
  UserLearningProfile,
  UserProfileDoc,
} from "@/types";

function adminDb(): Firestore | null {
  const app = getFirebaseAdminApp();
  return app ? getFirestore(app) : null;
}

function toDate(value: Timestamp | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (value instanceof Timestamp) return value.toDate();
  return null;
}

function mapCheckpoint(raw: DocumentData): Checkpoint {
  return {
    id: String(raw.id ?? ""),
    timestampSeconds: Number(raw.timestampSeconds ?? 0),
    label: String(raw.label ?? ""),
    summary: raw.summary != null ? String(raw.summary) : undefined,
    completed:
      typeof raw.completed === "boolean" ? raw.completed : undefined,
  };
}

function mapRecallQuestion(raw: DocumentData): SessionRecallQuestion {
  return {
    id: String(raw.id ?? ""),
    question: String(raw.question ?? ""),
    hint: String(raw.hint ?? ""),
  };
}

function snapshotToSession(id: string, data: DocumentData): Session {
  const rq = data.recallQuestions;
  return {
    id,
    userId: String(data.userId ?? ""),
    videoId: String(data.videoId ?? ""),
    videoTitle: String(data.videoTitle ?? ""),
    goal: String(data.goal ?? ""),
    checkpoints: Array.isArray(data.checkpoints)
      ? data.checkpoints.map((c: DocumentData) => mapCheckpoint(c))
      : [],
    startedAt: toDate(data.startedAt as Timestamp) ?? new Date(0),
    endedAt: toDate(data.endedAt as Timestamp | null),
    status: (data.status as SessionStatus) ?? "active",
    totalWatchSeconds: Number(data.totalWatchSeconds ?? 0),
    recallQuestions: Array.isArray(rq)
      ? rq.map((c: DocumentData) => mapRecallQuestion(c))
      : undefined,
  };
}

function sessionToPlain(
  data: Partial<Omit<Session, "id">>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (data.userId !== undefined) out.userId = data.userId;
  if (data.videoId !== undefined) out.videoId = data.videoId;
  if (data.videoTitle !== undefined) out.videoTitle = data.videoTitle;
  if (data.goal !== undefined) out.goal = data.goal;
  if (data.checkpoints !== undefined) out.checkpoints = data.checkpoints;
  if (data.status !== undefined) out.status = data.status;
  if (data.totalWatchSeconds !== undefined) {
    out.totalWatchSeconds = data.totalWatchSeconds;
  }
  if (data.startedAt !== undefined) {
    out.startedAt = Timestamp.fromDate(data.startedAt);
  }
  if (data.endedAt !== undefined) {
    out.endedAt =
      data.endedAt === null ? null : Timestamp.fromDate(data.endedAt);
  }
  if (data.recallQuestions !== undefined) {
    out.recallQuestions = data.recallQuestions;
  }
  return out;
}

// --- Admin implementations ---

async function adminGetUserProfile(
  f: Firestore,
  userId: string,
): Promise<UserProfileDoc | null> {
  const snap = await f.collection("users").doc(userId).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  const profileRaw = d.profile as Record<string, unknown> | undefined;
  const onboardingCompleted =
    typeof d.onboardingCompleted === "boolean"
      ? d.onboardingCompleted
      : undefined;
  const onboardingCompletedAt = toDate(
    (d.onboardingCompletedAt as Timestamp | undefined) ?? null,
  );

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
      typeof d.sessions_used === "number" ? Number(d.sessions_used) : undefined,
    plan: d.plan === "pro" ? "pro" : d.plan === "free" ? "free" : undefined,
  };
}

async function adminSaveOnboardingData(
  f: Firestore,
  userId: string,
  data: UserLearningProfile,
): Promise<void> {
  await f.collection("users").doc(userId).set(
    {
      onboardingCompleted: true,
      onboardingCompletedAt: FieldValue.serverTimestamp(),
      profile: {
        level: data.level,
        mediumTermGoal: data.mediumTermGoal,
        painPoints: data.painPoints,
        sessionLength: data.sessionLength,
        techFocus: data.techFocus,
        noteStyle: data.noteStyle,
      },
    },
    { merge: true },
  );
}

async function adminGetUserUsage(f: Firestore, userId: string): Promise<UserUsage> {
  const snap = await f.collection("users").doc(userId).get();
  if (!snap.exists) {
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

async function adminIncrementUsage(f: Firestore, userId: string): Promise<void> {
  const ref = f.collection("users").doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({ sessions_used: 1, plan: "free" as const });
    return;
  }
  await ref.update({ sessions_used: FieldValue.increment(1) });
}

async function adminUpgradeToPro(f: Firestore, userId: string): Promise<void> {
  await f.collection("users").doc(userId).set({ plan: "pro" as const }, { merge: true });
}

async function adminCreateSession(
  f: Firestore,
  data: Omit<Session, "id">,
): Promise<string> {
  const ref = await f.collection("sessions").add(sessionToPlain(data));
  return ref.id;
}

async function adminGetSession(
  f: Firestore,
  sessionId: string,
): Promise<Session | null> {
  const snap = await f.collection("sessions").doc(sessionId).get();
  if (!snap.exists) return null;
  return snapshotToSession(snap.id, snap.data() as DocumentData);
}

async function adminUpdateSession(
  f: Firestore,
  sessionId: string,
  data: Partial<Omit<Session, "id">>,
): Promise<void> {
  const payload = sessionToPlain(data);
  if (Object.keys(payload).length === 0) return;
  await f.collection("sessions").doc(sessionId).update(payload);
}

async function adminAddNote(
  f: Firestore,
  data: Omit<Note, "id">,
): Promise<string> {
  const ref = await f.collection("notes").add({
    sessionId: data.sessionId,
    timestamp: data.timestamp,
    type: data.type,
    content: data.content,
    createdAt: Timestamp.fromDate(data.createdAt),
  });
  return ref.id;
}

// --- Public: prefer Admin in API routes; fall back to client SDK ---

export async function serverGetUserProfile(
  userId: string,
): Promise<UserProfileDoc | null> {
  const f = adminDb();
  if (f) return adminGetUserProfile(f, userId);
  const { getUserProfile } = await import("@/lib/firestore");
  return getUserProfile(userId);
}

export async function serverSaveOnboardingData(
  userId: string,
  data: UserLearningProfile,
): Promise<void> {
  const f = adminDb();
  if (f) return adminSaveOnboardingData(f, userId, data);
  const { saveOnboardingData } = await import("@/lib/firestore");
  return saveOnboardingData(userId, data);
}

export async function serverGetUserUsage(userId: string): Promise<UserUsage> {
  const f = adminDb();
  if (f) return adminGetUserUsage(f, userId);
  const { getUserUsage } = await import("@/lib/usage");
  return getUserUsage(userId);
}

export async function serverIncrementUsage(userId: string): Promise<void> {
  const f = adminDb();
  if (f) return adminIncrementUsage(f, userId);
  const { incrementUsage } = await import("@/lib/usage");
  return incrementUsage(userId);
}

export async function serverUpgradeToPro(userId: string): Promise<void> {
  const f = adminDb();
  if (f) return adminUpgradeToPro(f, userId);
  const { upgradeToPro } = await import("@/lib/usage");
  return upgradeToPro(userId);
}

export async function serverCanStartSession(userId: string): Promise<boolean> {
  const { plan, sessions_used } = await serverGetUserUsage(userId);
  return plan === "pro" || sessions_used < 5;
}

export async function serverCreateSession(
  data: Omit<Session, "id">,
): Promise<string> {
  const f = adminDb();
  if (f) return adminCreateSession(f, data);
  const { createSession } = await import("@/lib/firestore");
  return createSession(data);
}

export async function serverGetSession(
  sessionId: string,
): Promise<Session | null> {
  const f = adminDb();
  if (f) return adminGetSession(f, sessionId);
  const { getSession } = await import("@/lib/firestore");
  return getSession(sessionId);
}

export async function serverUpdateSession(
  sessionId: string,
  data: Partial<Omit<Session, "id">>,
): Promise<void> {
  const f = adminDb();
  if (f) return adminUpdateSession(f, sessionId, data);
  const { updateSession } = await import("@/lib/firestore");
  return updateSession(sessionId, data);
}

export async function serverAddNote(data: Omit<Note, "id">): Promise<string> {
  const f = adminDb();
  if (f) return adminAddNote(f, data);
  const { addNote } = await import("@/lib/firestore");
  return addNote(data);
}

/** True when `FIREBASE_SERVICE_ACCOUNT_JSON` is valid and Admin is active. */
export function isFirestoreAdminConfigured(): boolean {
  return adminDb() !== null;
}
