"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Bookmark, Note, Session } from "@/types";

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function minutesWatched(totalSeconds: number): number {
  return Math.max(0, Math.floor(totalSeconds / 60));
}

function formatStatMinutes(totalSeconds: number): string {
  return `${minutesWatched(totalSeconds)}m`;
}

function sessionDateForFilename(session: Session): string {
  const d = session.endedAt ?? session.startedAt;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function sessionDateDisplay(session: Session): string {
  const d = session.endedAt ?? session.startedAt;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function escapeMdInline(s: string): string {
  return s.replace(/\r?\n/g, " ").trim();
}

function buildExportMarkdown(
  session: Session,
  notes: Note[],
  bookmarks: Bookmark[],
): string {
  const mins = minutesWatched(session.totalWatchSeconds);
  const dateLine = sessionDateDisplay(session);

  const lines: string[] = [
    "# NoHell Session Notes",
    "",
    `**Goal:** ${escapeMdInline(session.goal)}`,
    `**Duration:** ${mins} minutes`,
    `**Date:** ${dateLine}`,
    "",
    "## AI Notes",
  ];

  for (const n of notes) {
    const body = escapeMdInline(n.content);
    lines.push(`- [${formatClock(n.timestamp)}] **${n.type}**: ${body}`);
  }

  lines.push("", "## Bookmarks");

  for (const b of bookmarks) {
    lines.push(
      `- ${formatClock(b.timestampSeconds)}: ${escapeMdInline(b.label)}`,
    );
  }

  lines.push("", "## Recall Questions", "");

  const rq = session.recallQuestions ?? [];
  rq.forEach((q, i) => {
    lines.push(`${i + 1}. ${escapeMdInline(q.question)}`);
    const h = q.hint?.trim();
    if (h) lines.push(`   Hint: ${escapeMdInline(h)}`);
    lines.push("");
  });

  return lines.join("\n").replace(/\n+$/, "\n");
}

export default function SessionRecapPage() {
  const params = useParams();
  const sessionId =
    typeof params.sessionId === "string" ? params.sessionId : "";

  const [session, setSession] = useState<Session | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setError("Missing session");
      setLoading(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [sessionRes, notesRes, bookmarksRes] = await Promise.all([
          fetch(`/api/sessions/${encodeURIComponent(sessionId)}`),
          fetch(`/api/sessions/${encodeURIComponent(sessionId)}/notes`),
          fetch(`/api/sessions/${encodeURIComponent(sessionId)}/bookmarks`),
        ]);
        if (cancelled) return;
        if (!sessionRes.ok) {
          setError(sessionRes.status === 404 ? "Session not found" : "Failed to load session");
          setSession(null);
          setNotes([]);
          setBookmarks([]);
          return;
        }
        const { session: rawSession } = await sessionRes.json() as { session?: Session };
        if (!rawSession) throw new Error("Missing session");
        setSession({
          ...rawSession,
          startedAt: new Date(rawSession.startedAt),
          endedAt: rawSession.endedAt ? new Date(rawSession.endedAt) : null,
        });
        if (notesRes.ok) {
          const { notes: rawNotes = [] } = await notesRes.json() as { notes?: Note[] };
          setNotes(rawNotes.map((note) => ({ ...note, createdAt: new Date(note.createdAt) })));
        } else {
          setNotes([]);
        }
        if (bookmarksRes.ok) {
          const { bookmarks: rawBookmarks = [] } = await bookmarksRes.json() as { bookmarks?: Bookmark[] };
          setBookmarks(rawBookmarks.map((bookmark) => ({ ...bookmark, createdAt: new Date(bookmark.createdAt) })));
        } else {
          setBookmarks([]);
        }
      } catch {
        if (!cancelled) setError("Failed to load session");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const exportMarkdown = useCallback(() => {
    if (!session) return;
    const md = buildExportMarkdown(session, notes, bookmarks);
    const blob = new Blob([md], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nohell-session-${sessionDateForFilename(session)}.md`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [session, notes, bookmarks]);

  const stats = useMemo(() => {
    if (!session) return null;
    return {
      timeLabel: formatStatMinutes(session.totalWatchSeconds),
      notesCount: notes.length,
      bookmarksCount: bookmarks.length,
    };
  }, [session, notes.length, bookmarks.length]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-nh-bg px-4">
        <p className="text-sm text-nh-muted">Loading recap…</p>
      </div>
    );
  }

  if (error || !session || !stats) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-nh-bg px-4">
        <p className="text-sm text-nh-muted">{error ?? "Not found"}</p>
        <Link href="/" className="text-sm underline">
          Home
        </Link>
      </div>
    );
  }

  const questions = session.recallQuestions ?? [];

  return (
    <div className="min-h-screen bg-nh-bg px-4 py-10 text-nh-text">
      <div className="mx-auto max-w-3xl">
        <p className="mb-1 text-xs uppercase tracking-wide text-nh-muted">
          Session complete
        </p>
        <h1 className="mb-2 text-xl font-semibold">{session.videoTitle}</h1>
        <p className="mb-8 text-sm text-nh-muted">
          <span className="font-medium text-neutral-800">Goal: </span>
          {session.goal}
        </p>

        <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="border border-nh-border bg-nh-surface px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-nh-muted">
              Time watched
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {stats.timeLabel}
            </p>
          </div>
          <div className="border border-nh-border bg-nh-surface px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-nh-muted">
              AI notes taken
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {stats.notesCount}
            </p>
          </div>
          <div className="border border-nh-border bg-nh-surface px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-nh-muted">
              Bookmarks
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {stats.bookmarksCount}
            </p>
          </div>
        </div>

        <section className="mb-6">
          <h2 className="mb-1 text-lg font-semibold">Recall Questions</h2>
          <p className="mb-4 text-sm text-nh-muted">
            Try to answer without looking at your notes
          </p>
          {questions.length === 0 ? (
            <p className="text-sm text-nh-muted">
              No recall questions were saved for this session.
            </p>
          ) : (
            <ul className="space-y-3">
              {questions.map((q, index) => (
                <li
                  key={q.id}
                  className="border border-nh-border bg-nh-surface p-4 text-sm"
                >
                  <div className="flex gap-3">
                    <span className="shrink-0 font-mono text-xs text-neutral-400">
                      {index + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-nh-text">{q.question}</p>
                      {q.hint ? (
                        <p className="mt-2 text-xs text-nh-muted">
                          {q.hint}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-4 border-t border-neutral-200 pt-8">
          <button
            type="button"
            className="border border-neutral-400 bg-nh-surface px-4 py-2 text-sm font-medium hover:bg-neutral-100"
            onClick={exportMarkdown}
          >
            Export
          </button>
          <Link
            href="/"
            className="border border-transparent px-4 py-2 text-sm text-neutral-700 underline hover:text-nh-text"
          >
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}
