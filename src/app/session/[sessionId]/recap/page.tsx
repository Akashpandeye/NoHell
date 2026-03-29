"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { getBookmarks, getNotes, getSession } from "@/lib/firestore";
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
        const [s, n, b] = await Promise.all([
          getSession(sessionId),
          getNotes(sessionId),
          getBookmarks(sessionId),
        ]);
        if (cancelled) return;
        if (!s) {
          setError("Session not found");
          setSession(null);
          setNotes([]);
          setBookmarks([]);
          return;
        }
        setSession(s);
        setNotes(n);
        setBookmarks(b);
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
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p className="text-sm text-neutral-600">Loading recap…</p>
      </div>
    );
  }

  if (error || !session || !stats) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4">
        <p className="text-sm text-neutral-600">{error ?? "Not found"}</p>
        <Link href="/" className="text-sm underline">
          Home
        </Link>
      </div>
    );
  }

  const questions = session.recallQuestions ?? [];

  return (
    <div className="min-h-screen bg-neutral-50 px-4 py-10 text-neutral-900">
      <div className="mx-auto max-w-3xl">
        <p className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
          Session complete
        </p>
        <h1 className="mb-2 text-xl font-semibold">{session.videoTitle}</h1>
        <p className="mb-8 text-sm text-neutral-600">
          <span className="font-medium text-neutral-800">Goal: </span>
          {session.goal}
        </p>

        <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="border border-neutral-300 bg-white px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">
              Time watched
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {stats.timeLabel}
            </p>
          </div>
          <div className="border border-neutral-300 bg-white px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">
              AI notes taken
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {stats.notesCount}
            </p>
          </div>
          <div className="border border-neutral-300 bg-white px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">
              Bookmarks
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {stats.bookmarksCount}
            </p>
          </div>
        </div>

        <section className="mb-6">
          <h2 className="mb-1 text-lg font-semibold">Recall Questions</h2>
          <p className="mb-4 text-sm text-neutral-500">
            Try to answer without looking at your notes
          </p>
          {questions.length === 0 ? (
            <p className="text-sm text-neutral-600">
              No recall questions were saved for this session.
            </p>
          ) : (
            <ul className="space-y-3">
              {questions.map((q, index) => (
                <li
                  key={q.id}
                  className="border border-neutral-300 bg-white p-4 text-sm"
                >
                  <div className="flex gap-3">
                    <span className="shrink-0 font-mono text-xs text-neutral-400">
                      {index + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-neutral-900">{q.question}</p>
                      {q.hint ? (
                        <p className="mt-2 text-xs text-neutral-500">
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
            className="border border-neutral-400 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-100"
            onClick={exportMarkdown}
          >
            Export
          </button>
          <Link
            href="/"
            className="border border-transparent px-4 py-2 text-sm text-neutral-700 underline hover:text-neutral-900"
          >
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}
