"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addBookmark as persistBookmark,
  getBookmarks,
  getNotes,
  getSession,
  updateSession,
} from "@/lib/firestore";
import {
  getChunkAtSecond,
  getCumulativeTextUpToSecond,
  splitTranscriptByTime,
  type TranscriptChunk,
  type TranscriptLine,
} from "@/lib/transcript";
import type { Note, Session, TutorialRevisionCard } from "@/types";

type TabId = "ai" | "my" | "bookmarks";

/** Client-only flag for entrance animation (stripped after animation). */
type AiNoteRow = Note & { animate?: boolean };

/** TEST MODE — change to 300_000 for production (5 minutes). */
const NOTE_GENERATE_INTERVAL_MS = 30_000;

/** TEST MODE — change to 3_600_000 for production (3600 seconds = 1 hour). */
const REVISION_CARD_INTERVAL_MS = 3 * 60 * 1000;

type BookmarkItem = {
  id: string;
  label: string;
  timestampSeconds: number;
};

/** M:SS (minutes not zero-padded). */
function formatBookmarkTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function videoDurationSec(
  session: Session | null,
  chunks: TranscriptChunk[],
): number {
  if (session && session.totalWatchSeconds > 0) {
    return session.totalWatchSeconds;
  }
  if (chunks.length > 0) {
    return Math.max(...chunks.map((c) => c.endSec), 0);
  }
  return 1;
}

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";

  const [session, setSession] = useState<Session | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [aiNotes, setAiNotes] = useState<AiNoteRow[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [boardOpen, setBoardOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("ai");
  const [myNotesText, setMyNotesText] = useState("");
  const [filledCheckpointIds, setFilledCheckpointIds] = useState<
    Record<string, boolean>
  >({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [capturingNotes, setCapturingNotes] = useState(false);
  const [revisionOverlay, setRevisionOverlay] =
    useState<TutorialRevisionCard | null>(null);
  const [ending, setEnding] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteIntervalRef = useRef<number | null>(null);
  const revisionIntervalRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const revisionOverlayRef = useRef<TutorialRevisionCard | null>(null);
  const addBookmarkRef = useRef<() => void>(() => {});

  const durationSec = useMemo(
    () => videoDurationSec(session, transcript),
    [session, transcript],
  );

  useEffect(() => {
    if (!sessionId) {
      setLoadError("Missing session id");
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const s = await getSession(sessionId);
        if (cancelled) return;
        if (!s) {
          setLoadError("Session not found");
          setSession(null);
          return;
        }
        setSession(s);

        const tRes = await fetch(
          `/api/transcript?videoId=${encodeURIComponent(s.videoId)}`,
        );
        let chunks: TranscriptChunk[] = [];
        let lines: TranscriptLine[] = [];
        if (tRes.ok) {
          lines = (await tRes.json()) as TranscriptLine[];
          chunks = splitTranscriptByTime(lines, 5);
        }
        if (cancelled) return;
        setTranscriptLines(lines);
        setTranscript(chunks);

        let notesFromDb: AiNoteRow[] = [];
        try {
          const existing = await getNotes(sessionId);
          notesFromDb = existing
            .slice()
            .sort(
              (a, b) =>
                b.createdAt.getTime() - a.createdAt.getTime(),
            );
        } catch {
          notesFromDb = [];
        }
        setAiNotes(notesFromDb);

        let bms: BookmarkItem[] = [];
        try {
          const existingBm = await getBookmarks(sessionId);
          bms = existingBm.map((b) => ({
            id: b.id,
            label: b.label,
            timestampSeconds: b.timestampSeconds,
          }));
        } catch {
          bms = [];
        }
        setBookmarks(bms);
      } catch {
        if (!cancelled) setLoadError("Failed to load session");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  useEffect(() => {
    revisionOverlayRef.current = revisionOverlay;
  }, [revisionOverlay]);

  useEffect(() => {
    if (loading || !session || loadError) return;
    timerRef.current = setInterval(() => {
      setElapsedSeconds((x) => x + 1);
    }, 1000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [loading, session, loadError]);

  useEffect(() => {
    if (loading || !session || loadError || !sessionId) return;

    const id = window.setInterval(() => {
      const sec = elapsedRef.current;
      const chunk = getChunkAtSecond(transcript, sec);
      if (!chunk || !chunk.text.trim()) return;

      void (async () => {
        setCapturingNotes(true);
        try {
          const res = await fetch("/api/notes/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chunk: chunk.text,
              sessionId,
              timestamp: formatClock(sec),
            }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as { notes?: Note[] };
          const notes = Array.isArray(data.notes) ? data.notes : [];
          if (notes.length === 0) return;
          const rows: AiNoteRow[] = notes.map((n) => ({
            ...n,
            createdAt:
              n.createdAt instanceof Date
                ? n.createdAt
                : new Date(String(n.createdAt)),
            animate: true,
          }));
          setAiNotes((prev) => [...rows, ...prev]);
        } catch {
          /* network / parse */
        } finally {
          setCapturingNotes(false);
        }
      })();
    }, NOTE_GENERATE_INTERVAL_MS);

    noteIntervalRef.current = id;
    return () => {
      window.clearInterval(id);
      noteIntervalRef.current = null;
    };
  }, [loading, session, loadError, sessionId, transcript]);

  useEffect(() => {
    if (loading || !session || loadError || !sessionId) return;

    const windowSec = Math.floor(REVISION_CARD_INTERVAL_MS / 1000);

    const id = window.setInterval(() => {
      if (revisionOverlayRef.current) return;

      const sec = elapsedRef.current;
      const cumulative = getCumulativeTextUpToSecond(transcriptLines, sec);
      if (!cumulative.trim()) return;

      const startSec = Math.max(0, sec - windowSec);
      const timeRange = `${formatClock(startSec)} – ${formatClock(sec)}`;

      void (async () => {
        try {
          const res = await fetch("/api/revision/card", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cumulativeText: cumulative,
              sessionId,
              timeRange,
            }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            revision_card?: TutorialRevisionCard;
          };
          if (data.revision_card) setRevisionOverlay(data.revision_card);
        } catch {
          /* ignore */
        }
      })();
    }, REVISION_CARD_INTERVAL_MS);

    revisionIntervalRef.current = id;
    return () => {
      window.clearInterval(id);
      revisionIntervalRef.current = null;
    };
  }, [loading, session, loadError, sessionId, transcriptLines]);

  const checkpointPositions = useMemo(() => {
    if (!session?.checkpoints.length) return [];
    const n = session.checkpoints.length;
    return session.checkpoints.map((cp, i) => {
      const hasTs = cp.timestampSeconds > 0;
      const pct = hasTs
        ? Math.min(100, (cp.timestampSeconds / durationSec) * 100)
        : ((i + 1) / (n + 1)) * 100;
      return { checkpoint: cp, pct };
    });
  }, [session, durationSec]);

  const toggleCheckpointDot = useCallback((id: string) => {
    setFilledCheckpointIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, []);

  const addBookmark = useCallback(() => {
    if (!sessionId) return;

    void (async () => {
      const sec = elapsedRef.current;
      const label = "Revisit this";
      try {
        const id = await persistBookmark({
          sessionId,
          timestampSeconds: sec,
          label,
          createdAt: new Date(),
        });
        setBookmarks((prev) => [
          ...prev,
          { id, label, timestampSeconds: sec },
        ]);
        setBoardOpen(true);
        setActiveTab("bookmarks");
      } catch {
        /* db error */
      }
    })();
  }, [sessionId]);

  useEffect(() => {
    addBookmarkRef.current = addBookmark;
  }, [addBookmark]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "b" && e.key !== "B") return;
      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (
          tag === "TEXTAREA" ||
          tag === "INPUT" ||
          tag === "SELECT" ||
          el.isContentEditable
        ) {
          return;
        }
      }
      e.preventDefault();
      addBookmarkRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const stopAllIntervals = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (noteIntervalRef.current) {
      clearInterval(noteIntervalRef.current);
      noteIntervalRef.current = null;
    }
    if (revisionIntervalRef.current) {
      clearInterval(revisionIntervalRef.current);
      revisionIntervalRef.current = null;
    }
  }, []);

  const endSession = useCallback(async () => {
    if (ending || !sessionId || !session) return;
    setEnding(true);
    stopAllIntervals();

    const elapsed = elapsedRef.current;
    const notesPayload = aiNotes.map((n) => n.content);

    try {
      await updateSession(sessionId, {
        status: "completed",
        endedAt: new Date(),
        totalWatchSeconds: elapsed,
      });
    } catch {
      /* still try API + redirect */
    }

    try {
      await fetch("/api/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          notes: notesPayload,
          goal: session.goal,
        }),
      });
    } catch {
      /* recap may still load session */
    }

    router.push(`/session/${sessionId}/recap`);
  }, [
    ending,
    sessionId,
    session,
    aiNotes,
    router,
    stopAllIntervals,
  ]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center border border-neutral-300 bg-neutral-50">
        <p className="text-sm text-neutral-600">Loading session…</p>
      </div>
    );
  }

  if (loadError || !session) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 border border-neutral-300 bg-neutral-50">
        <p className="text-sm text-neutral-600">{loadError ?? "Not found"}</p>
        <Link href="/" className="text-sm underline">
          Home
        </Link>
      </div>
    );
  }

  const videoId = session.videoId;
  const embedSrc = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden border border-neutral-300 bg-neutral-50">
      {revisionOverlay ? (
        <div
          className="absolute inset-0 z-[100] flex flex-col bg-neutral-950/88 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revision-time-range"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <header className="mb-6 border-b border-neutral-600 pb-3">
              <p className="text-[10px] uppercase tracking-wider text-neutral-400">
                Time range
              </p>
              <h2
                id="revision-time-range"
                className="font-mono text-lg text-neutral-100"
              >
                {revisionOverlay.time_range}
              </h2>
            </header>

            <section className="mb-6 space-y-3">
              <h3 className="text-xs font-semibold text-neutral-300">
                Concepts
              </h3>
              <ul className="space-y-3">
                {revisionOverlay.concepts.map((c, i) => (
                  <li
                    key={`${c.name}-${i}`}
                    className="border border-neutral-600 bg-neutral-900/80 p-3 text-sm text-neutral-200"
                  >
                    <p className="mb-2 font-semibold text-neutral-100">
                      {c.name}
                    </p>
                    <p className="mb-1 text-neutral-300">
                      <span className="text-neutral-500">What: </span>
                      {c.what}
                    </p>
                    <p className="mb-1 text-neutral-300">
                      <span className="text-neutral-500">Why: </span>
                      {c.why}
                    </p>
                    {c.analogy ? (
                      <p className="italic text-neutral-400">{c.analogy}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            {revisionOverlay.code_skeleton.trim() ? (
              <section className="mb-6">
                <h3 className="mb-2 text-xs font-semibold text-neutral-300">
                  Code skeleton
                </h3>
                <pre className="overflow-x-auto border border-neutral-600 bg-neutral-950 p-3 font-mono text-xs text-neutral-200">
                  {revisionOverlay.code_skeleton}
                </pre>
              </section>
            ) : null}

            <section className="mb-8 border-t border-neutral-600 pt-4">
              <h3 className="mb-2 text-xs font-semibold text-neutral-300">
                Recall
              </h3>
              <p className="text-sm text-neutral-200">
                {revisionOverlay.recall_question}
              </p>
            </section>
          </div>

          <div className="shrink-0 border-t border-neutral-600 bg-neutral-950/90 px-4 py-4 sm:px-8">
            <button
              type="button"
              className="w-full border border-neutral-500 bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-900 hover:bg-white"
              onClick={() => setRevisionOverlay(null)}
            >
              Resume video
            </button>
          </div>
        </div>
      ) : null}

      {/* TOP BAR 50px */}
      <header className="flex h-[50px] min-h-[50px] shrink-0 items-center border-b border-neutral-300 px-3">
        <Link href="/" className="shrink-0 text-sm font-semibold">
          NoHell
        </Link>

        <div className="flex flex-1 items-center justify-center px-4">
          <div className="relative h-3 w-full max-w-md border border-neutral-400 bg-neutral-200">
            <div
              className="absolute left-0 top-0 h-full bg-neutral-400/40"
              style={{
                width: `${Math.min(100, (elapsedSeconds / Math.max(durationSec, 1)) * 100)}%`,
              }}
              aria-hidden
            />
            {checkpointPositions.map(({ checkpoint, pct }) => {
              const filled = !!filledCheckpointIds[checkpoint.id];
              return (
                <button
                  key={checkpoint.id}
                  type="button"
                  title={checkpoint.label}
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-neutral-600"
                  style={{ left: `${pct}%` }}
                  onClick={() => toggleCheckpointDot(checkpoint.id)}
                  aria-pressed={filled}
                >
                  <span
                    className={`block size-full rounded-full ${
                      filled ? "bg-neutral-800" : "bg-neutral-100"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="font-mono text-sm tabular-nums">
            {formatClock(elapsedSeconds)}
          </span>
          <button
            type="button"
            className="border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
            onClick={addBookmark}
            disabled={ending}
          >
            Bookmark
          </button>
          <button
            type="button"
            className="border border-neutral-400 px-2 py-1 text-xs disabled:opacity-50"
            onClick={() => void endSession()}
            disabled={ending}
          >
            {ending ? "Ending…" : "End Session"}
          </button>
        </div>
      </header>

      {/* MAIN */}
      <div className="flex min-h-0 flex-1 flex-row">
        {/* LEFT: video */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-r border-neutral-300">
          <div className="relative min-h-0 flex-1">
            <iframe
              title="Video"
              className="absolute inset-0 h-full w-full border-0"
              src={embedSrc}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>
          <div className="shrink-0 border-t border-neutral-300 px-3 py-2 text-xs">
            <span className="font-medium">Goal: </span>
            <span>{session.goal}</span>
          </div>
        </div>

        {/* TOGGLE strip 22px */}
        <button
          type="button"
          className="flex w-[22px] min-w-[22px] shrink-0 items-center justify-center border-r border-neutral-300 bg-neutral-200 text-[10px]"
          onClick={() => setBoardOpen((o) => !o)}
          aria-expanded={boardOpen}
          aria-label={boardOpen ? "Hide notes" : "Show notes"}
        >
          {boardOpen ? "›" : "‹"}
        </button>

        {/* RIGHT: board */}
        <aside
          className={`flex min-h-0 flex-col overflow-hidden border-l border-neutral-300 bg-neutral-100 transition-[width] duration-200 ${
            boardOpen ? "w-[340px] min-w-[340px]" : "w-0 min-w-0 border-l-0"
          }`}
        >
          <div className="flex shrink-0 flex-col gap-1 border-b border-neutral-300 px-2 py-1">
            <div className="flex">
              {(
                [
                  ["ai", "AI Notes"],
                  ["my", "My Notes"],
                  ["bookmarks", "Bookmarks"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`flex flex-1 items-center justify-center gap-1 px-1 py-2 text-xs ${
                    activeTab === id ? "border-b-2 border-neutral-800" : ""
                  }`}
                  onClick={() => setActiveTab(id)}
                >
                  <span>{label}</span>
                  {id === "ai" && aiNotes.length > 0 ? (
                    <span
                      className="min-w-[1.1rem] rounded-full border border-neutral-400 px-1 text-[10px] leading-none text-neutral-600"
                      aria-label={`${aiNotes.length} AI notes`}
                    >
                      {aiNotes.length}
                    </span>
                  ) : null}
                  {id === "bookmarks" && bookmarks.length > 0 ? (
                    <span
                      className="min-w-[1.1rem] rounded-full border border-neutral-400 px-1 text-[10px] leading-none text-neutral-600"
                      aria-label={`${bookmarks.length} bookmarks`}
                    >
                      {bookmarks.length}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            {activeTab === "ai" && capturingNotes ? (
              <p className="text-[10px] text-neutral-500">capturing notes…</p>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeTab === "ai" && (
              <ul className="h-full list-none overflow-y-auto p-2">
                {aiNotes.map((note) => (
                  <li
                    key={note.id}
                    className={`mb-2 border border-neutral-300 bg-white p-2 text-xs ${
                      note.animate ? "nh-ai-note-enter" : ""
                    }`}
                    onAnimationEnd={() => {
                      if (!note.animate) return;
                      setAiNotes((prev) =>
                        prev.map((n) =>
                          n.id === note.id ? { ...n, animate: undefined } : n,
                        ),
                      );
                    }}
                  >
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <span className="rounded border border-neutral-400 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-700">
                        {note.type}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-neutral-500">
                        {formatClock(note.timestamp)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-neutral-800">
                      {note.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {activeTab === "my" && (
              <textarea
                className="h-full w-full resize-none border-0 bg-white p-2 text-xs outline-none"
                placeholder="Your notes…"
                value={myNotesText}
                onChange={(e) => setMyNotesText(e.target.value)}
              />
            )}
            {activeTab === "bookmarks" && (
              <ul className="h-full list-none overflow-y-auto p-2 text-xs">
                {bookmarks.map((b) => (
                  <li
                    key={b.id}
                    className="mb-1 border border-neutral-300 bg-white px-2 py-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-neutral-800">{b.label}</span>
                      <span
                        className="shrink-0 font-mono tabular-nums text-neutral-600"
                        title={`${b.timestampSeconds} seconds`}
                      >
                        {formatBookmarkTime(b.timestampSeconds)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
