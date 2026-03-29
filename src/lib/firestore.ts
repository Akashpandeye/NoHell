import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import type {
  Bookmark,
  Checkpoint,
  Note,
  Session,
  SessionRecallQuestion,
  SessionStatus,
} from "@/types";

function toDate(value: Timestamp | Date | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  return value.toDate();
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

function snapshotToNote(id: string, data: DocumentData): Note {
  return {
    id,
    sessionId: String(data.sessionId ?? ""),
    timestamp: Number(data.timestamp ?? 0),
    type: data.type as Note["type"],
    content: String(data.content ?? ""),
    createdAt: toDate(data.createdAt as Timestamp) ?? new Date(0),
  };
}

function snapshotToBookmark(id: string, data: DocumentData): Bookmark {
  return {
    id,
    sessionId: String(data.sessionId ?? ""),
    timestampSeconds: Number(data.timestampSeconds ?? 0),
    label: String(data.label ?? ""),
    createdAt: toDate(data.createdAt as Timestamp) ?? new Date(0),
  };
}

function sessionToFirestore(
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

/**
 * Creates a session document; returns the generated Firestore document id.
 */
export async function createSession(data: Omit<Session, "id">): Promise<string> {
  const ref = await addDoc(collection(db, "sessions"), sessionToFirestore(data));
  return ref.id;
}

/**
 * Loads a single session by id, or `null` if missing.
 */
export async function getSession(sessionId: string): Promise<Session | null> {
  const snap = await getDoc(doc(db, "sessions", sessionId));
  if (!snap.exists()) return null;
  return snapshotToSession(snap.id, snap.data());
}

/**
 * Shallow-merge fields onto the session document.
 */
export async function updateSession(
  sessionId: string,
  data: Partial<Omit<Session, "id">>,
): Promise<void> {
  const payload = sessionToFirestore(data);
  if (Object.keys(payload).length === 0) return;
  await updateDoc(doc(db, "sessions", sessionId), payload);
}

/**
 * Adds a note; returns the new document id.
 */
export async function addNote(data: Omit<Note, "id">): Promise<string> {
  const ref = await addDoc(collection(db, "notes"), {
    sessionId: data.sessionId,
    timestamp: data.timestamp,
    type: data.type,
    content: data.content,
    createdAt: Timestamp.fromDate(data.createdAt),
  });
  return ref.id;
}

/**
 * All notes for a session, ordered by `timestamp` ascending.
 */
export async function getNotes(sessionId: string): Promise<Note[]> {
  const q = query(
    collection(db, "notes"),
    where("sessionId", "==", sessionId),
  );
  const snap = await getDocs(q);
  const notes = snap.docs.map((d) => snapshotToNote(d.id, d.data()));
  notes.sort((a, b) => a.timestamp - b.timestamp);
  return notes;
}

/**
 * Adds a bookmark; returns the new document id.
 */
export async function addBookmark(data: Omit<Bookmark, "id">): Promise<string> {
  const ref = await addDoc(collection(db, "bookmarks"), {
    sessionId: data.sessionId,
    timestampSeconds: data.timestampSeconds,
    label: data.label,
    createdAt: Timestamp.fromDate(data.createdAt),
  });
  return ref.id;
}

/**
 * All bookmarks for a session, ordered by `timestampSeconds` ascending.
 */
export async function getBookmarks(sessionId: string): Promise<Bookmark[]> {
  const q = query(
    collection(db, "bookmarks"),
    where("sessionId", "==", sessionId),
  );
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => snapshotToBookmark(d.id, d.data()));
  items.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  return items;
}
