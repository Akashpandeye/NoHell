"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  addBookmark as persistBookmark,
  deleteBookmark,
  getBookmarks,
  getNotes,
  getSession,
  updateBookmarkLabel,
  updateSession,
} from "@/lib/firestore";
import {
  getChunkAtSecond,
  getCumulativeTextUpToSecond,
  splitTranscriptByTime,
  type TranscriptChunk,
  type TranscriptLine,
} from "@/lib/transcript";
import type { Note, NoteType, Session, TutorialRevisionCard } from "@/types";

type TabId = "ai" | "my" | "bookmarks";

type AiNoteRow = Note & { animate?: boolean; editedContent?: string };

const NOTE_GENERATE_INTERVAL_MS = 30_000;
const REVISION_CARD_INTERVAL_MS = 3 * 60 * 1000;

const PANEL_MIN_W = 280;
const PANEL_MAX_W = 600;
const PANEL_DEFAULT_W = 380;

const FOCUS_PRESETS = [15, 25, 45, 60] as const;

const YT_IFRAME_ID = "nh-session-yt-embed";

type YTPlayerLike = {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
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

const NOTE_CATEGORIES: { type: NoteType; label: string; color: string }[] = [
  { type: "theory", label: "Theory", color: "border-l-sky-400" },
  { type: "important", label: "Important", color: "border-l-amber-400" },
  { type: "syntax", label: "Syntax", color: "border-l-emerald-400" },
  { type: "logic", label: "Logic", color: "border-l-violet-400" },
];

const LEGACY_TYPE_MAP: Record<string, NoteType> = {
  concept: "theory",
  tip: "important",
  code: "syntax",
  warning: "logic",
};

function normalizeNoteType(raw: string): NoteType {
  if (raw in LEGACY_TYPE_MAP) return LEGACY_TYPE_MAP[raw]!;
  return raw as NoteType;
}

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
  if (session && session.totalWatchSeconds > 0) return session.totalWatchSeconds;
  if (chunks.length > 0) return Math.max(...chunks.map((c) => c.endSec), 0);
  return 1;
}

// ---------------------------------------------------------------------------
// Inline-editable note content
// ---------------------------------------------------------------------------
function EditableContent({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
  }, [draft, value, onChange]);

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        setDraft(value);
        setEditing(false);
      }
    },
    [value],
  );

  if (editing) {
    return (
      <textarea
        ref={ref}
        className="w-full resize-none rounded border border-nh-border bg-nh-surface p-1.5 text-xs leading-relaxed text-nh-text outline-none transition-colors duration-150 focus:border-nh-teal"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <p
      className="cursor-text whitespace-pre-wrap rounded px-1.5 py-1 text-nh-text transition-colors duration-150 hover:bg-nh-surface-2"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title="Click to edit"
    >
      {value}
    </p>
  );
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
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([]);
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [aiNotes, setAiNotes] = useState<AiNoteRow[]>([]);
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
  const [collapsedCategories, setCollapsedCategories] = useState<
    Record<string, boolean>
  >({});
  const [dragging, setDragging] = useState(false);
  const [captionNotice, setCaptionNotice] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noteIntervalRef = useRef<number | null>(null);
  const revisionIntervalRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const revisionOverlayRef = useRef<TutorialRevisionCard | null>(null);
  const addBookmarkRef = useRef<() => void>(() => {});
  const dragStartXRef = useRef(0);
  const dragStartWRef = useRef(PANEL_DEFAULT_W);
  const ytPlayerRef = useRef<YTPlayerLike | null>(null);
  const ytPlayerInstanceRef = useRef<YTPlayerLike | null>(null);

  const [playerOrigin, setPlayerOrigin] = useState("");

  const durationSec = useMemo(
    () => videoDurationSec(session, transcript),
    [session, transcript],
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
    };
  }, [embedSrc, loading, playerOrigin, session?.videoId]);

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
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
    if (!sessionId || typeof window === "undefined") return;
    try {
      if (sessionStorage.getItem(`nh-tx-${sessionId}`) === "1") {
        sessionStorage.removeItem(`nh-tx-${sessionId}`);
        setCaptionNotice(true);
      }
    } catch {
      /* private mode */
    }
  }, [sessionId]);

  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  useEffect(() => {
    revisionOverlayRef.current = revisionOverlay;
  }, [revisionOverlay]);

  // ---- timer ----
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

  // ---- auto note generation ----
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

  // ---- revision card ----
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
    setFilledCheckpointIds((prev) => ({ ...prev, [id]: !prev[id] }));
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
    void (async () => {
      try {
        await deleteBookmark(id);
        setBookmarks((prev) => prev.filter((b) => b.id !== id));
      } catch {
        /* db error */
      }
    })();
  }, []);

  const renameBookmark = useCallback(async (id: string, label: string) => {
    try {
      await updateBookmarkLabel(id, label);
      setBookmarks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, label } : b)),
      );
    } catch {
      /* db error */
    }
  }, []);

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
    const notesPayload = aiNotes.map(
      (n) => n.editedContent ?? n.content,
    );

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
  }, [ending, sessionId, session, aiNotes, router, stopAllIntervals]);

  // ---- grouped notes by category (deduplicated) ----
  const notesByCategory = useMemo(() => {
    const map: Record<NoteType, AiNoteRow[]> = {
      theory: [],
      important: [],
      syntax: [],
      logic: [],
    };
    const seenTexts: string[] = [];
    for (const n of aiNotes) {
      const norm = n.content.trim().toLowerCase().replace(/\s+/g, " ");
      const isDup = seenTexts.some(
        (s) => s === norm || s.includes(norm) || norm.includes(s),
      );
      if (isDup) continue;
      seenTexts.push(norm);
      const t = normalizeNoteType(n.type);
      (map[t] ??= []).push(n);
    }
    return map;
  }, [aiNotes]);

  const updateNoteContent = useCallback((noteId: string, content: string) => {
    setAiNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, editedContent: content } : n,
      ),
    );
  }, []);

  const toggleCategory = useCallback((type: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

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

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-nh-bg text-nh-text">
      {/* Prevent text selection while dragging panel */}
      {dragging && (
        <div className="pointer-events-auto fixed inset-0 z-[200] cursor-col-resize" />
      )}

      {/* ---- Revision overlay ---- */}
      {revisionOverlay ? (
        <div
          className="absolute inset-0 z-[100] flex flex-col bg-neutral-950/88 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revision-time-range"
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            <header className="mb-6 border-b border-nh-border pb-3">
              <p className="text-[10px] uppercase tracking-wider text-nh-dim">
                Revision card
              </p>
              <h2
                id="revision-time-range"
                className="font-mono text-lg text-nh-text"
              >
                {revisionOverlay.time_range}
              </h2>
            </header>

            <section className="mb-6 space-y-3">
              <h3 className="text-xs font-semibold text-nh-muted">Concepts</h3>
              <ul className="space-y-3">
                {revisionOverlay.concepts.map((c, i) => (
                  <li
                    key={`${c.name}-${i}`}
                    className="rounded-xl border border-nh-border bg-nh-surface p-4 text-sm text-nh-text"
                  >
                    <p className="mb-2 font-semibold">{c.name}</p>
                    <p className="mb-1 text-nh-muted">
                      <span className="text-nh-dim">What: </span>
                      {c.what}
                    </p>
                    <p className="mb-1 text-nh-muted">
                      <span className="text-nh-dim">Why: </span>
                      {c.why}
                    </p>
                    {c.analogy ? (
                      <p className="italic text-nh-dim">{c.analogy}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            {revisionOverlay.code_skeleton.trim() ? (
              <section className="mb-6">
                <h3 className="mb-2 text-xs font-semibold text-nh-muted">
                  Code skeleton
                </h3>
                <pre className="overflow-x-auto rounded-xl border border-nh-border bg-nh-surface p-4 font-mono text-xs leading-relaxed text-nh-text">
                  {revisionOverlay.code_skeleton}
                </pre>
              </section>
            ) : null}

            <section className="mb-8 border-t border-nh-border pt-4">
              <h3 className="mb-2 text-xs font-semibold text-nh-muted">
                Recall
              </h3>
              <p className="text-sm text-nh-text">
                {revisionOverlay.recall_question}
              </p>
            </section>
          </div>

          <div className="shrink-0 border-t border-nh-border bg-nh-bg/90 px-4 py-4 sm:px-8">
            <button
              type="button"
              className="w-full cursor-pointer rounded-xl bg-nh-cta px-4 py-3 text-sm font-bold text-neutral-950 shadow-sm transition-colors duration-200 hover:bg-nh-cta-hover"
              onClick={() => setRevisionOverlay(null)}
            >
              Resume Video
            </button>
          </div>
        </div>
      ) : null}

      {/* ---- TOP BAR ---- */}
      <header className="flex h-[50px] min-h-[50px] shrink-0 items-center border-b border-nh-border px-3">
        <Link
          href="/"
          className="shrink-0 cursor-pointer text-sm font-semibold text-nh-text transition-colors duration-200 hover:text-nh-teal"
        >
          NoHell
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
      <div className="flex min-h-0 flex-1">
        {/* Video area */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {captionNotice ? (
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-amber-500/35 bg-amber-500/10 px-4 py-2.5">
              <p className="min-w-0 text-xs leading-relaxed text-amber-100/95">
                YouTube captions couldn&apos;t be loaded from this server (YouTube
                often blocks caption requests from cloud hosts like Vercel). The
                embed still works; timed AI notes and revision cards need captions
                and stay off until a transcript can be fetched.
              </p>
              <button
                type="button"
                className="shrink-0 cursor-pointer rounded-lg border border-amber-500/40 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition-colors duration-200 hover:bg-amber-500/20"
                onClick={() => setCaptionNotice(false)}
              >
                Dismiss
              </button>
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
              {/* ---- AI NOTES (categorized) ---- */}
              {activeTab === "ai" && (
                <div className="h-full overflow-y-auto p-3">
                  {NOTE_CATEGORIES.map(({ type, label, color }) => {
                    const notes = notesByCategory[type];
                    if (!notes || notes.length === 0) return null;
                    const collapsed = !!collapsedCategories[type];
                    return (
                      <div key={type} className="mb-4">
                        <button
                          type="button"
                          className="mb-2 flex w-full cursor-pointer items-center gap-2 text-left transition-colors duration-150 hover:text-nh-text"
                          onClick={() => toggleCategory(type)}
                        >
                          <span className="text-[10px] text-nh-dim">
                            {collapsed ? "▸" : "▾"}
                          </span>
                          <span className="text-[11px] font-bold uppercase tracking-widest text-nh-muted">
                            {label}
                          </span>
                          <span className="text-[10px] text-nh-dim">
                            ({notes.length})
                          </span>
                        </button>
                        {!collapsed && (
                          <ul className="space-y-2">
                            {notes.map((note) => (
                              <li
                                key={note.id}
                                className={`rounded-xl border border-nh-border border-l-2 ${color} bg-nh-surface p-2.5 text-xs ${
                                  note.animate ? "nh-ai-note-enter" : ""
                                }`}
                                onAnimationEnd={() => {
                                  if (!note.animate) return;
                                  setAiNotes((prev) =>
                                    prev.map((n) =>
                                      n.id === note.id
                                        ? { ...n, animate: undefined }
                                        : n,
                                    ),
                                  );
                                }}
                              >
                                <div className="mb-1.5 flex items-center justify-between gap-2">
                                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-nh-dim">
                                    {formatClock(note.timestamp)}
                                  </span>
                                </div>
                                <EditableContent
                                  value={
                                    note.editedContent ?? note.content
                                  }
                                  onChange={(v) =>
                                    updateNoteContent(note.id, v)
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  {aiNotes.length === 0 && (
                    <p className="py-8 text-center text-xs text-nh-dim">
                      Notes will appear here as you watch.
                    </p>
                  )}
                </div>
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
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
