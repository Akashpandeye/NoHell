"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  getTranscriptTextInRange,
  splitTranscriptByTime,
  type TranscriptChunk,
  type TranscriptLine,
  type TranscriptResolution,
} from "@/lib/transcript";
import { AimMark } from "@/components/brand/AimMark";
import {
  AiNotesSections,
  type AiNoteDisplayRow,
} from "@/components/session/AiNotesSections";
import { RevisionOverlay } from "@/components/session/RevisionOverlay";
import type { Note, Session, TutorialRevisionCard } from "@/types";

type TabId = "ai" | "my" | "bookmarks" | "summary";

type AiNoteRow = AiNoteDisplayRow;

type SummaryPoint = {
  timestamp: number;
  points: string[];
};

const NOTE_SEGMENT_SECONDS = 60;
const REVISION_WINDOW_SECONDS = 3 * 60;
const PLAYER_POLL_INTERVAL_MS = 500;

const PANEL_MIN_W = 280;
const PANEL_MAX_W = 600;
const PANEL_DEFAULT_W = 380;

const FOCUS_PRESETS = [15, 25, 45, 60] as const;

const YT_IFRAME_ID = "nh-session-yt-embed";

type YTPlayerLike = {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

let ytApiLoadPromise: Promise<void> | null = null;

function ensureYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  const w = window as Window & {
    YT?: { Player: new (id: string, opts: object) => YTPlayerLike };
    onYouTubeIframeAPIReady?: () => void;
  };
  if (w.YT?.Player) return Promise.resolve();
  if (!ytApiLoadPromise) {
    ytApiLoadPromise = new Promise((resolve) => {
      const prior = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => {
        try {
          prior?.();
        } catch {
          /* ignore */
        }
        resolve();
      };
      const exists = document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]',
      );
      if (!exists) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(tag);
      } else {
        const iv = window.setInterval(() => {
          if (w.YT?.Player) {
            window.clearInterval(iv);
            resolve();
          }
        }, 50);
        window.setTimeout(() => {
          window.clearInterval(iv);
          resolve();
        }, 8000);
      }
    });
  }
  return ytApiLoadPromise;
}

type BookmarkItem = {
  id: string;
  label: string;
  timestampSeconds: number;
};

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

function transcriptStatusMessage(
  result: TranscriptResolution | null,
): string | null {
  if (!result || result.status === "ready") return null;
  if (result.status === "fetching") {
    return "Captions are being prepared. Video playback is available while timed learning features wait.";
  }
  if (result.status === "unavailable") {
    return "This video does not have usable captions. Playback still works, but timed AI notes, summaries, and revision cards need captions.";
  }
  if (
    result.error.code === "provider_not_configured" ||
    result.error.code === "direct_fallback_disabled"
  ) {
    return "Production caption extraction is not configured. Connect the external transcript provider to enable timed AI notes, summaries, and revision cards.";
  }
  return "Captions are temporarily unavailable. Playback still works, and you can retry caption extraction.";
}

function videoDurationSec(
  session: Session | null,
  chunks: TranscriptChunk[],
): number {
  if (session && session.totalWatchSeconds > 0) return session.totalWatchSeconds;
  if (chunks.length > 0) return Math.max(...chunks.map((c) => c.endSec), 0);
  return 1;
}

// ---------------------------------------------------------------------------
// Focus Timer Widget
// ---------------------------------------------------------------------------
function FocusTimer() {
  const [totalMin, setTotalMin] = useState(25);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const running = remaining !== null && remaining > 0;
  const done = remaining === 0;

  useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r === null || r <= 0) return 0;
        return r - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const start = useCallback(() => {
    setRemaining(totalMin * 60);
    setOpen(false);
  }, [totalMin]);

  const reset = useCallback(() => {
    setRemaining(null);
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const display = remaining !== null ? formatClock(remaining) : null;

  return (
    <div className="relative">
      <button
        type="button"
        className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs transition-colors duration-200 ${
          done
            ? "border-nh-cta bg-nh-cta/20 text-nh-cta"
            : running
              ? "border-nh-teal/50 text-nh-teal"
              : "border-nh-border text-nh-muted hover:border-nh-teal/50 hover:text-nh-text"
        }`}
        onClick={() => {
          if (done) {
            reset();
          } else if (running) {
            reset();
          } else {
            setOpen((o) => !o);
          }
        }}
      >
        {done
          ? "Break!"
          : running
            ? display
            : "Focus"}
      </button>

      {open && !running && (
        <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-xl border border-nh-border bg-nh-surface p-3 shadow-lg">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-nh-dim">
            Focus duration
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {FOCUS_PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setTotalMin(m)}
                className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                  totalMin === m
                    ? "border-nh-cta bg-nh-cta/10 text-nh-text"
                    : "border-nh-border text-nh-muted hover:border-nh-cta/50"
                }`}
              >
                {m}m
              </button>
            ))}
          </div>
          <div className="mb-3 flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={180}
              value={totalMin}
              onChange={(e) => {
                const v = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(v) && v > 0) setTotalMin(Math.min(v, 180));
              }}
              className="w-16 rounded-lg border border-nh-border bg-nh-bg px-2 py-1.5 text-xs text-nh-text outline-none transition-colors duration-150 focus:border-nh-teal"
            />
            <span className="text-[10px] text-nh-dim">min</span>
          </div>
          <button
            type="button"
            onClick={start}
            className="w-full cursor-pointer rounded-lg bg-nh-cta px-3 py-2 text-xs font-bold text-neutral-950 transition-colors duration-200 hover:bg-nh-cta-hover"
          >
            Start Focus
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bookmark row: jump, rename (double-click), remove
// ---------------------------------------------------------------------------
function BookmarkRow({
  bookmark,
  onSeek,
  onRemove,
  onRename,
}: {
  bookmark: BookmarkItem;
  onSeek: (seconds: number) => void;
  onRemove: (id: string) => void;
  onRename: (id: string, label: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bookmark.label);

  useEffect(() => {
    if (!editing) setDraft(bookmark.label);
  }, [bookmark.label, editing]);

  const commitRename = useCallback(async () => {
    const t = draft.trim();
    if (!t) {
      setDraft(bookmark.label);
      setEditing(false);
      return;
    }
    if (t !== bookmark.label) {
      await onRename(bookmark.id, t);
    }
    setEditing(false);
  }, [bookmark.id, bookmark.label, draft, onRename]);

  return (
    <li className="mb-2 rounded-xl border border-nh-border bg-nh-surface p-2 transition-colors duration-150 hover:bg-nh-surface-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          title="Jump to this moment in the video"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-nh-teal/40 bg-nh-teal/10 text-nh-teal transition-colors duration-200 hover:border-nh-teal hover:bg-nh-teal/20"
          onClick={() => onSeek(bookmark.timestampSeconds)}
          aria-label={`Jump video to ${formatBookmarkTime(bookmark.timestampSeconds)}`}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              className="w-full rounded-lg border border-nh-border bg-nh-bg px-2 py-1 text-xs text-nh-text outline-none focus:border-nh-teal"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") {
                  setDraft(bookmark.label);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="w-full cursor-pointer text-left text-xs text-nh-text"
              title="Double-click to rename"
              onDoubleClick={() => {
                setDraft(bookmark.label);
                setEditing(true);
              }}
            >
              <span className="line-clamp-2">{bookmark.label}</span>
            </button>
          )}
          <p className="mt-0.5 font-mono text-[10px] tabular-nums text-nh-muted">
            {formatBookmarkTime(bookmark.timestampSeconds)}
          </p>
        </div>
        <button
          type="button"
          title="Remove bookmark"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-nh-border text-nh-muted transition-colors duration-200 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
          onClick={() => onRemove(bookmark.id)}
          aria-label="Remove bookmark"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId =
    typeof params.sessionId === "string" ? params.sessionId : "";

  const [session, setSession] = useState<Session | null>(null);
  const [runningSessions, setRunningSessions] = useState<Session[]>([]);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [aiNotes, setAiNotes] = useState<AiNoteRow[]>([]);
  const [summaryPoints, setSummaryPoints] = useState<SummaryPoint[]>([]);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [boardOpen, setBoardOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_W);
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
  const [dragging, setDragging] = useState(false);
  const [transcriptOutcome, setTranscriptOutcome] =
    useState<TranscriptResolution | null>(null);
  const [retryingTranscript, setRetryingTranscript] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [playerDuration, setPlayerDuration] = useState(0);

  const playerPollRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const processedNoteSegmentsRef = useRef(new Set<number>());
  const processedRevisionWindowsRef = useRef(new Set<number>());
  const transcriptFollowUpAttemptedRef = useRef(false);
  const revisionOverlayRef = useRef<TutorialRevisionCard | null>(null);
  const addBookmarkRef = useRef<() => void>(() => {});
  const dragStartXRef = useRef(0);
  const dragStartWRef = useRef(PANEL_DEFAULT_W);
  const ytPlayerRef = useRef<YTPlayerLike | null>(null);
  const ytPlayerInstanceRef = useRef<YTPlayerLike | null>(null);

  const [playerOrigin, setPlayerOrigin] = useState("");

  const durationSec = useMemo(
    () => playerDuration || videoDurationSec(session, transcript),
    [playerDuration, session, transcript],
  );

  const videoIdForEmbed = session?.videoId ?? "";
  const embedSrc = useMemo(() => {
    if (!videoIdForEmbed || !playerOrigin) return "";
    return `https://www.youtube.com/embed/${encodeURIComponent(videoIdForEmbed)}?enablejsapi=1&rel=0&origin=${encodeURIComponent(playerOrigin)}`;
  }, [videoIdForEmbed, playerOrigin]);

  useEffect(() => {
    setPlayerOrigin(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  // ---- drag-to-resize ----
  const onDragStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      setDragging(true);
      dragStartXRef.current = e.clientX;
      dragStartWRef.current = panelWidth;
    },
    [panelWidth],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: globalThis.MouseEvent) => {
      const dx = dragStartXRef.current - e.clientX;
      const next = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, dragStartWRef.current + dx));
      setPanelWidth(next);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  // ---- YouTube IFrame API (seek from bookmarks) ----
  useEffect(() => {
    if (!playerOrigin || loading || !session?.videoId || !embedSrc) return;
    let cancelled = false;

    void (async () => {
      await ensureYouTubeIframeApi();
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      if (cancelled) return;
      const w = window as Window & {
        YT?: { Player: new (id: string, opts: object) => YTPlayerLike };
      };
      if (!w.YT?.Player || !document.getElementById(YT_IFRAME_ID)) return;
      try {
        new w.YT.Player(YT_IFRAME_ID, {
          events: {
            onReady: (e: { target: YTPlayerLike }) => {
              if (cancelled) return;
              ytPlayerInstanceRef.current = e.target;
              ytPlayerRef.current = e.target;
              const duration = Math.max(0, Math.floor(e.target.getDuration()));
              const savedPosition = Math.max(
                0,
                Math.min(Math.floor(session.totalWatchSeconds), duration),
              );
              if (savedPosition > 0) {
                for (
                  let index = 0;
                  index < Math.floor(savedPosition / NOTE_SEGMENT_SECONDS);
                  index += 1
                ) {
                  processedNoteSegmentsRef.current.add(index);
                }
                for (
                  let index = 0;
                  index < Math.floor(savedPosition / REVISION_WINDOW_SECONDS);
                  index += 1
                ) {
                  processedRevisionWindowsRef.current.add(index);
                }
                e.target.seekTo(savedPosition, true);
                elapsedRef.current = savedPosition;
                setElapsedSeconds(savedPosition);
              }
              setPlayerDuration(duration);
              setPlayerReady(true);
            },
          },
        });
      } catch {
        /* iframe not ready */
      }
    })();

    return () => {
      cancelled = true;
      try {
        ytPlayerInstanceRef.current?.destroy();
      } catch {
        /* ignore */
      }
      ytPlayerInstanceRef.current = null;
      ytPlayerRef.current = null;
      setPlayerReady(false);
      setPlayerDuration(0);
    };
  }, [embedSrc, loading, playerOrigin, session?.totalWatchSeconds, session?.videoId]);

  const applyTranscriptResult = useCallback((result: TranscriptResolution) => {
    setTranscriptOutcome(result);
    if (result.status === "ready") {
      setTranscriptLines(result.lines);
      setTranscript(splitTranscriptByTime(result.lines, 5));
      return;
    }
    setTranscriptLines([]);
    setTranscript([]);
  }, []);

  // ---- data load ----
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
        const sessionRes = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
        if (!sessionRes.ok) {
          setLoadError(sessionRes.status === 404 ? "Session not found" : "Failed to load session");
          setSession(null);
          return;
        }
        const { session: rawSession } = await sessionRes.json() as { session?: Session };
        if (!rawSession) {
          setLoadError("Session not found");
          return;
        }
        const s: Session = {
          ...rawSession,
          startedAt: new Date(rawSession.startedAt),
          endedAt: rawSession.endedAt ? new Date(rawSession.endedAt) : null,
        };
        setSession(s);

        const [tRes, notesRes, bookmarksRes] = await Promise.all([
          fetch(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`),
          fetch(`/api/sessions/${encodeURIComponent(sessionId)}/notes`),
          fetch(`/api/sessions/${encodeURIComponent(sessionId)}/bookmarks`),
        ]);
        const runningRes = await fetch("/api/sessions");
        if (runningRes.ok) {
          const { sessions = [] } = await runningRes.json() as { sessions?: Session[] };
          setRunningSessions(sessions);
        } else {
          setRunningSessions([]);
        }
        let transcriptResult: TranscriptResolution;
        try {
          transcriptResult = (await tRes.json()) as TranscriptResolution;
        } catch {
          transcriptResult = {
            status: "failed",
            error: {
              code: "cache_error",
              message: "Transcript service returned an invalid response.",
              retryable: true,
              provider: "cache",
            },
            retryAfter: null,
          };
        }
        if (cancelled) return;
        applyTranscriptResult(transcriptResult);

        if (notesRes.ok) {
          const { notes = [] } = await notesRes.json() as { notes?: Note[] };
          const normalizedNotes = notes
            .map((note) => ({ ...note, createdAt: new Date(note.createdAt) }))
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          for (const note of normalizedNotes) {
            processedNoteSegmentsRef.current.add(
              Math.floor(note.timestamp / NOTE_SEGMENT_SECONDS),
            );
          }
          setAiNotes(normalizedNotes);
        } else {
          setAiNotes([]);
        }

        if (bookmarksRes.ok) {
          const { bookmarks: existing = [] } = await bookmarksRes.json() as { bookmarks?: Array<BookmarkItem> };
          setBookmarks(existing.map((bookmark) => ({
            id: bookmark.id,
            label: bookmark.label,
            timestampSeconds: bookmark.timestampSeconds,
          })));
        } else {
          setBookmarks([]);
        }
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
  }, [applyTranscriptResult, sessionId]);

  useEffect(() => {
    transcriptFollowUpAttemptedRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    if (
      !sessionId ||
      transcriptOutcome?.status !== "fetching" ||
      transcriptFollowUpAttemptedRef.current
    ) {
      return;
    }
    transcriptFollowUpAttemptedRef.current = true;
    const timeout = window.setTimeout(() => {
      void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/transcript`)
        .then(async (response) => (await response.json()) as TranscriptResolution)
        .then(applyTranscriptResult)
        .catch(() => {
          applyTranscriptResult({
            status: "failed",
            error: {
              code: "cache_error",
              message: "Transcript service is temporarily unavailable.",
              retryable: true,
              provider: "cache",
            },
            retryAfter: null,
          });
        });
    }, Math.min(10_000, Math.max(1_000, transcriptOutcome.retryAfterSeconds * 1_000)));
    return () => window.clearTimeout(timeout);
  }, [applyTranscriptResult, sessionId, transcriptOutcome]);

  const retryTranscript = useCallback(async () => {
    if (!sessionId || retryingTranscript) return;
    setRetryingTranscript(true);
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/transcript`,
        { method: "POST" },
      );
      applyTranscriptResult((await response.json()) as TranscriptResolution);
      transcriptFollowUpAttemptedRef.current = false;
    } catch {
      applyTranscriptResult({
        status: "failed",
        error: {
          code: "cache_error",
          message: "Transcript service is temporarily unavailable.",
          retryable: true,
          provider: "cache",
        },
        retryAfter: null,
      });
    } finally {
      setRetryingTranscript(false);
    }
  }, [applyTranscriptResult, retryingTranscript, sessionId]);

  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  const persistPlaybackPosition = useCallback(() => {
    if (!sessionId || !playerReady || !session) return;
    if (session.status === "completed" || session.status === "abandoned") return;

    const totalWatchSeconds = Math.max(0, Math.floor(elapsedRef.current));
    if (totalWatchSeconds <= 0) return;

    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totalWatchSeconds }),
      keepalive: true,
    }).catch(() => {
      /* A later interval or page load can retry the position. */
    });
  }, [playerReady, session, sessionId]);

  useEffect(() => {
    if (!session || !playerReady || session.status === "completed" || session.status === "abandoned") {
      return;
    }

    const interval = window.setInterval(persistPlaybackPosition, 10_000);
    window.addEventListener("pagehide", persistPlaybackPosition);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pagehide", persistPlaybackPosition);
    };
  }, [persistPlaybackPosition, playerReady, session]);

  useEffect(() => {
    revisionOverlayRef.current = revisionOverlay;
  }, [revisionOverlay]);

  // ---- player-synchronised timeline and generation ----
  useEffect(() => {
    if (
      loading ||
      !session ||
      loadError ||
      !sessionId ||
      !playerReady ||
      transcriptOutcome?.status !== "ready"
    ) {
      return;
    }
    let lastObservedSecond = -1;

    const processCompletedSegment = (segmentIndex: number) => {
      if (processedNoteSegmentsRef.current.has(segmentIndex)) return;
      const startSec = segmentIndex * NOTE_SEGMENT_SECONDS;
      const endSec = startSec + NOTE_SEGMENT_SECONDS;
      const chunk = getTranscriptTextInRange(transcriptLines, startSec, endSec);
      if (!chunk) return;
      processedNoteSegmentsRef.current.add(segmentIndex);
      void (async () => {
        setCapturingNotes(true);
        try {
          const res = await fetch("/api/notes/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chunk, sessionId, timestamp: formatClock(startSec) }),
          });
          if (!res.ok) {
            processedNoteSegmentsRef.current.delete(segmentIndex);
            return;
          }
          const data = await res.json() as { notes?: Note[] };
          const notes = Array.isArray(data.notes) ? data.notes : [];
          setAiNotes((previous) => [
            ...notes.map((note) => ({ ...note, createdAt: new Date(note.createdAt), animate: true })),
            ...previous,
          ]);
        } catch {
          processedNoteSegmentsRef.current.delete(segmentIndex);
        } finally {
          setCapturingNotes(false);
        }
      })();
    };

    const processRevisionWindow = (windowIndex: number) => {
      if (revisionOverlayRef.current || processedRevisionWindowsRef.current.has(windowIndex)) return;
      const startSec = windowIndex * REVISION_WINDOW_SECONDS;
      const endSec = startSec + REVISION_WINDOW_SECONDS;
      const text = getTranscriptTextInRange(transcriptLines, startSec, endSec);
      if (!text) return;
      processedRevisionWindowsRef.current.add(windowIndex);
      void (async () => {
        try {
          const res = await fetch("/api/revision/card", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cumulativeText: text,
              sessionId,
              timeRange: `${formatClock(startSec)} – ${formatClock(endSec)}`,
            }),
          });
          if (!res.ok) {
            processedRevisionWindowsRef.current.delete(windowIndex);
            return;
          }
          const data = await res.json() as { revision_card?: TutorialRevisionCard };
          if (data.revision_card) {
            ytPlayerRef.current?.pauseVideo();
            setRevisionOverlay(data.revision_card);
          }
        } catch {
          processedRevisionWindowsRef.current.delete(windowIndex);
        }
      })();
    };

    playerPollRef.current = window.setInterval(() => {
      const player = ytPlayerRef.current;
      if (!player || player.getPlayerState() !== 1) return;
      const currentSecond = Math.max(0, Math.floor(player.getCurrentTime()));
      setElapsedSeconds(currentSecond);

      // A large jump indicates seek/initial buffering. Do not turn skipped video
      // into generated notes; subsequent naturally watched windows remain eligible.
      const jumpedForward =
        lastObservedSecond >= 0 && currentSecond - lastObservedSecond > 3;
      lastObservedSecond = currentSecond;
      if (jumpedForward) {
        for (
          let index = 0;
          index < Math.floor(currentSecond / NOTE_SEGMENT_SECONDS);
          index += 1
        ) {
          processedNoteSegmentsRef.current.add(index);
        }
        for (
          let index = 0;
          index < Math.floor(currentSecond / REVISION_WINDOW_SECONDS);
          index += 1
        ) {
          processedRevisionWindowsRef.current.add(index);
        }
        return;
      }

      for (let index = 0; index < Math.floor(currentSecond / NOTE_SEGMENT_SECONDS); index += 1) {
        processCompletedSegment(index);
      }
      const completedWindow = Math.floor(currentSecond / REVISION_WINDOW_SECONDS) - 1;
      if (completedWindow >= 0) processRevisionWindow(completedWindow);
    }, PLAYER_POLL_INTERVAL_MS);

    return () => {
      if (playerPollRef.current) {
        clearInterval(playerPollRef.current);
        playerPollRef.current = null;
      }
    };
  }, [
    loading,
    session,
    loadError,
    sessionId,
    playerReady,
    transcriptLines,
    transcriptOutcome?.status,
  ]);

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
    setFilledCheckpointIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const addBookmark = useCallback(() => {
    if (!sessionId) return;

    void (async () => {
      const sec = elapsedRef.current;
      const label = "Revisit this";
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/bookmarks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timestampSeconds: sec, label }),
        });
        if (!res.ok) return;
        const { bookmark } = await res.json() as { bookmark?: BookmarkItem };
        if (!bookmark) return;
        setBookmarks((prev) => [...prev, bookmark]);
        setBoardOpen(true);
        setActiveTab("bookmarks");
      } catch {
        /* network error */
      }
    })();
  }, [sessionId]);

  const seekToBookmark = useCallback(
    (seconds: number) => {
      const p = ytPlayerRef.current;
      if (p) {
        try {
          p.seekTo(seconds, true);
          p.playVideo();
        } catch {
          /* API not ready */
        }
        return;
      }
      const vid = session?.videoId;
      if (vid) {
        window.open(
          `https://www.youtube.com/watch?v=${encodeURIComponent(vid)}&t=${Math.floor(seconds)}`,
          "_blank",
          "noopener,noreferrer",
        );
      }
    },
    [session?.videoId],
  );

  const removeBookmark = useCallback((id: string) => {
    if (!sessionId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/bookmarks/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (res.ok) setBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== id));
      } catch {
        /* network error */
      }
    })();
  }, [sessionId]);

  const renameBookmark = useCallback(async (id: string, label: string) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/bookmarks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (res.ok) setBookmarks((prev) =>
        prev.map((bookmark) => (bookmark.id === id ? { ...bookmark, label } : bookmark)),
      );
    } catch {
      /* network error */
    }
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
        )
          return;
      }
      e.preventDefault();
      addBookmarkRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const stopAllIntervals = useCallback(() => {
    if (playerPollRef.current) {
      clearInterval(playerPollRef.current);
      playerPollRef.current = null;
    }
    ytPlayerRef.current?.pauseVideo();
  }, []);

  const endSession = useCallback(async () => {
    if (ending || !sessionId || !session) return;
    setEnding(true);
    stopAllIntervals();

    const elapsed = elapsedRef.current;

    try {
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "completed",
          endedAt: new Date().toISOString(),
          totalWatchSeconds: elapsed,
        }),
      });
    } catch {
      /* still try recall generation + redirect */
    }

    try {
      await fetch("/api/session/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch {
      /* recap may still load session */
    }

    router.push(`/session/${sessionId}/recap`);
  }, [ending, sessionId, session, router, stopAllIntervals]);

  const watchedTranscript = useMemo(
    () => transcriptLines
      .filter((line) => line.start <= elapsedSeconds)
      .sort((a, b) => a.start - b.start)
      .map((line) => `[${formatClock(line.start)}] ${line.text.trim()}`)
      .filter((line) => line.length > 8)
      .join("\n"),
    [elapsedSeconds, transcriptLines],
  );

  const summarizeWatchedContent = useCallback(async () => {
    if (!sessionId || !watchedTranscript || summarizing) return;
    setSummarizing(true);
    setSummaryError(null);
    try {
      const res = await fetch("/api/session/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, transcript: watchedTranscript }),
      });
      const data = await res.json() as { summary?: SummaryPoint[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not summarize this session");
      setSummaryPoints(Array.isArray(data.summary) ? data.summary : []);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Could not summarize this session");
    } finally {
      setSummarizing(false);
    }
  }, [sessionId, summarizing, watchedTranscript]);

  const updateNoteContent = useCallback((noteId: string, content: string) => {
    if (!sessionId) return;
    setAiNotes((prev) => prev.map((note) =>
      note.id === noteId ? { ...note, content, editedContent: undefined } : note,
    ));
    void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/notes/${encodeURIComponent(noteId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  }, [sessionId]);

  // ---- renders ----

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-nh-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-nh-teal border-t-transparent" />
          <p className="text-sm text-nh-muted">Loading session…</p>
        </div>
      </div>
    );
  }

  if (loadError || !session) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-nh-bg">
        <p className="text-sm text-nh-muted">{loadError ?? "Not found"}</p>
        <Link
          href="/"
          className="cursor-pointer text-sm text-nh-teal underline transition-colors duration-200 hover:text-nh-cta"
        >
          Home
        </Link>
      </div>
    );
  }

  const videoId = session.videoId;
  const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const transcriptMessage = transcriptStatusMessage(transcriptOutcome);
  const transcriptCanRetry =
    transcriptOutcome?.status === "failed" && transcriptOutcome.error.retryable;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-nh-bg text-nh-text">
      {/* Prevent text selection while dragging panel */}
      {dragging && (
        <div className="pointer-events-auto fixed inset-0 z-[200] cursor-col-resize" />
      )}

      {/* ---- Revision overlay ---- */}
      {revisionOverlay ? (
        <RevisionOverlay
          card={revisionOverlay}
          onResume={() => {
            setRevisionOverlay(null);
            ytPlayerRef.current?.playVideo();
          }}
        />
      ) : null}

      {/* ---- TOP BAR ---- */}
      <header className="flex h-[50px] min-h-[50px] shrink-0 items-center border-b border-nh-border px-3">
        <Link
          href="/"
          aria-label="NoHell home"
          className="group flex shrink-0 cursor-pointer items-center gap-2 text-sm font-semibold text-nh-text transition-colors duration-200 hover:text-nh-teal"
        >
          <AimMark className="h-6 w-6 shrink-0 text-nh-cta transition-transform duration-300 group-hover:scale-105" />
          <span className="font-display tracking-[-0.03em]">NoHell</span>
        </Link>

        <div className="flex flex-1 items-center justify-center px-4">
          <div className="relative h-2.5 w-full max-w-md rounded-full border border-nh-border bg-nh-surface">
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-nh-teal/30 transition-[width] duration-1000 ease-linear"
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
                  className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border border-nh-border transition-colors duration-150"
                  style={{ left: `${pct}%` }}
                  onClick={() => toggleCheckpointDot(checkpoint.id)}
                  aria-pressed={filled}
                >
                  <span
                    className={`block size-full rounded-full transition-colors duration-150 ${
                      filled ? "bg-nh-teal" : "bg-nh-surface"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-nh-teal/30 bg-nh-teal/5 px-3 py-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-nh-teal" />
            <span className="font-mono text-sm font-medium tabular-nums text-nh-teal">
              {formatClock(elapsedSeconds)}
            </span>
          </div>
          <FocusTimer />
          <button
            type="button"
            className="cursor-pointer rounded-lg border border-nh-border px-2.5 py-1 text-xs text-nh-text transition-colors duration-200 hover:border-nh-teal/50 hover:text-nh-teal disabled:cursor-not-allowed disabled:opacity-50"
            onClick={addBookmark}
            disabled={ending}
          >
            Bookmark
          </button>
          <button
            type="button"
            className="cursor-pointer rounded-lg border border-orange-500/40 bg-orange-500/10 px-2.5 py-1 text-xs text-orange-300 transition-colors duration-200 hover:border-orange-400/60 hover:bg-orange-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void endSession()}
            disabled={ending}
          >
            {ending ? "Ending…" : "End"}
          </button>
        </div>
      </header>

      {/* ---- MAIN AREA ---- */}
      <div className="relative flex min-h-0 flex-1">
        {runningSessions.length > 0 && !sessionsOpen ? (
          <button
            type="button"
            onClick={() => setSessionsOpen(true)}
            aria-label="Show your sessions"
            aria-expanded={false}
            title="Your sessions"
            className="flex w-10 min-w-10 shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 border-r border-nh-teal/30 bg-nh-teal/5 text-nh-teal transition-colors duration-200 hover:bg-nh-teal/10 hover:text-nh-text"
          >
            <span aria-hidden>📖</span>
          </button>
        ) : null}

        {runningSessions.length > 0 && sessionsOpen ? (
          <aside className="hidden w-60 min-w-60 shrink-0 flex-col border-r border-nh-border bg-nh-bg md:flex">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-nh-border px-3 py-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-nh-dim">
                  Your sessions
                </p>
                <p className="mt-1 text-xs text-nh-muted">
                  Switch without losing your notes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSessionsOpen(false)}
                aria-label="Hide your sessions"
                aria-expanded={true}
                title="Hide your sessions"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-base transition-colors hover:bg-nh-surface"
              >
                <span aria-hidden>📖</span>
              </button>
            </div>
            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" aria-label="Your active sessions">
              {runningSessions.map((item) => {
                const selected = item.id === session.id;
                return (
                  <Link
                    key={item.id}
                    href={`/session/${item.id}`}
                    aria-current={selected ? "page" : undefined}
                    className={`block rounded-xl border p-3 transition-colors hover:border-nh-teal/50 ${
                      selected
                        ? "border-nh-teal/40 bg-nh-teal/5"
                        : "border-transparent hover:bg-nh-surface"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.status === "active" ? "bg-nh-teal" : "bg-nh-dim"}`} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-nh-text">
                          {item.videoTitle}
                        </p>
                        <p className="mt-1 truncate text-[10px] text-nh-muted">
                          {item.goal}
                        </p>
                        <p className="mt-2 font-mono text-[10px] tabular-nums text-nh-dim">
                          {item.status === "active" ? "Watching" : "Paused"} · {formatClock(item.totalWatchSeconds)}
                        </p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </aside>
        ) : null}

        {/* Video area */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {transcriptMessage ? (
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-amber-500/35 bg-amber-500/10 px-4 py-2.5">
              <p className="min-w-0 text-xs leading-relaxed text-amber-100/95">
                {transcriptMessage}
              </p>
              {transcriptCanRetry ? (
                <button
                  type="button"
                  className="shrink-0 cursor-pointer rounded-lg border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition-colors duration-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void retryTranscript()}
                  disabled={retryingTranscript}
                >
                  {retryingTranscript ? "Retrying…" : "Retry captions"}
                </button>
              ) : null}
            </div>
          ) : null}
          {/* Goal bar */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-nh-border px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-nh-dim">
                Goal
              </p>
              <p className="truncate text-sm font-medium text-nh-text">
                {session.goal}
              </p>
            </div>
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 cursor-pointer rounded-lg border border-nh-border px-3 py-1.5 text-[11px] text-nh-muted transition-colors duration-200 hover:border-nh-teal/50 hover:text-nh-text"
            >
              Open on YouTube
            </a>
          </div>

          {/* Video embed (enablejsapi for bookmark seek) */}
          <div className="relative min-h-0 flex-1 bg-black">
            {embedSrc ? (
              <iframe
                id={YT_IFRAME_ID}
                title="Video"
                className="absolute inset-0 h-full w-full border-0"
                src={embedSrc}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-nh-muted">
                Loading player…
              </div>
            )}
          </div>
        </div>

        {/* ---- RESIZE HANDLE ---- */}
        {boardOpen && (
          <div
            className="flex w-[5px] min-w-[5px] shrink-0 cursor-col-resize items-center justify-center bg-nh-border/50 transition-colors duration-150 hover:bg-nh-teal/30 active:bg-nh-teal/50"
            onMouseDown={onDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize notes panel"
          />
        )}

        {/* ---- TOGGLE STRIP ---- */}
        {!boardOpen && (
          <button
            type="button"
            className="flex w-10 min-w-10 shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 border-l border-nh-teal/30 bg-nh-teal/5 text-nh-teal transition-colors duration-200 hover:bg-nh-teal/10 hover:text-nh-text"
            onClick={() => setBoardOpen(true)}
            aria-expanded={false}
            aria-label="Show notes"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <span className="text-[9px] font-bold uppercase tracking-wider [writing-mode:vertical-lr]">
              Notes
            </span>
          </button>
        )}

        {/* ---- NOTES PANEL ---- */}
        {boardOpen && (
          <aside
            className="flex min-h-0 flex-col overflow-hidden border-l border-nh-border bg-nh-bg"
            style={{ width: panelWidth, minWidth: panelWidth }}
          >
            {/* Panel header */}
            <div className="flex shrink-0 items-center justify-between border-b border-nh-border px-3 py-2">
              <div className="flex items-center gap-1">
                {(
                  [
                    ["ai", "AI Notes"],
                    ["my", "My Notes"],
                    ["bookmarks", "Bookmarks"],
                    ["summary", "Summary"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`cursor-pointer rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                      activeTab === id
                        ? "bg-nh-surface text-nh-text"
                        : "text-nh-muted hover:text-nh-text"
                    }`}
                    onClick={() => setActiveTab(id)}
                  >
                    <span>{label}</span>
                    {id === "ai" && aiNotes.length > 0 ? (
                      <span className="ml-1 text-[10px] text-nh-dim">
                        {aiNotes.length}
                      </span>
                    ) : null}
                    {id === "bookmarks" && bookmarks.length > 0 ? (
                      <span className="ml-1 text-[10px] text-nh-dim">
                        {bookmarks.length}
                      </span>
                    ) : null}
                    {id === "summary" && summaryPoints.length > 0 ? (
                      <span className="ml-1 text-[10px] text-nh-dim">
                        {summaryPoints.length}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="cursor-pointer rounded-lg p-1.5 text-nh-muted transition-colors duration-150 hover:bg-nh-surface hover:text-nh-text"
                onClick={() => setBoardOpen(false)}
                aria-label="Close notes panel"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {activeTab === "ai" && capturingNotes ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-nh-border px-3 py-1.5">
                <div className="h-2 w-2 animate-pulse rounded-full bg-nh-teal" />
                <p className="text-[10px] text-nh-dim">capturing notes…</p>
              </div>
            ) : null}

            {/* Tab content */}
            <div className="min-h-0 flex-1 overflow-hidden">
              {/* ---- AI NOTES ---- */}
              {activeTab === "ai" && (
                <AiNotesSections
                  notes={aiNotes}
                  onSeek={seekToBookmark}
                  onUpdateNote={updateNoteContent}
                  onAnimationComplete={(noteId) => {
                    setAiNotes((previous) =>
                      previous.map((note) =>
                        note.id === noteId
                          ? { ...note, animate: undefined }
                          : note,
                      ),
                    );
                  }}
                />
              )}

              {/* ---- MY NOTES ---- */}
              {activeTab === "my" && (
                <textarea
                  className="h-full w-full resize-none border-0 bg-nh-surface p-3 text-xs leading-relaxed text-nh-text outline-none transition-colors duration-150 placeholder:text-nh-dim focus:bg-nh-surface-2"
                  placeholder="Your notes…"
                  value={myNotesText}
                  onChange={(e) => setMyNotesText(e.target.value)}
                />
              )}

              {/* ---- BOOKMARKS ---- */}
              {activeTab === "bookmarks" && (
                <ul className="h-full list-none overflow-y-auto p-3 text-xs">
                  {bookmarks.map((b) => (
                    <BookmarkRow
                      key={b.id}
                      bookmark={b}
                      onSeek={seekToBookmark}
                      onRemove={removeBookmark}
                      onRename={renameBookmark}
                    />
                  ))}
                  {bookmarks.length === 0 && (
                    <p className="py-8 text-center text-xs text-nh-dim">
                      Press <kbd className="rounded border border-nh-border px-1.5 py-0.5 font-mono text-[10px]">B</kbd> to bookmark.
                    </p>
                  )}
                </ul>
              )}

              {/* ---- SUMMARY ---- */}
              {activeTab === "summary" && (
                <div className="h-full overflow-y-auto p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-nh-text">
                        Watched so far
                      </p>
                      <p className="mt-1 text-[10px] text-nh-dim">
                        Timestamped notes from the current video progress.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer rounded-lg bg-nh-cta px-3 py-2 text-[11px] font-bold text-neutral-950 transition-colors hover:bg-nh-cta-hover disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => void summarizeWatchedContent()}
                      disabled={
                        summarizing ||
                        transcriptOutcome?.status !== "ready" ||
                        !watchedTranscript
                      }
                    >
                      {summarizing ? "Summarizing…" : summaryPoints.length > 0 ? "Refresh" : "Summarize"}
                    </button>
                  </div>

                  {summaryError ? (
                    <p className="mb-3 rounded-lg border border-orange-500/30 bg-orange-500/10 p-2.5 text-xs text-orange-200">
                      {summaryError}
                    </p>
                  ) : null}

                  {summaryPoints.length > 0 ? (
                    <div className="space-y-2">
                      {summaryPoints.map((item, index) => (
                        <article
                          key={`${item.timestamp}-${index}`}
                          className="rounded-xl border border-nh-border border-l-2 border-l-nh-teal bg-nh-surface p-3"
                        >
                          <p className="mb-2 font-mono text-[10px] tabular-nums text-nh-teal">
                            {formatClock(item.timestamp)}
                          </p>
                          <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-nh-text">
                            {item.points.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="py-10 text-center text-xs leading-relaxed text-nh-dim">
                      {transcriptOutcome?.status === "ready"
                        ? "Watch a little, then summarize what you have covered."
                        : "A transcript is required before this summary can be generated."}
                    </p>
                  )}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
