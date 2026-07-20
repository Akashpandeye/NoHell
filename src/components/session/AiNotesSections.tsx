"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import type { Note, NoteType } from "@/types";

export type AiNoteDisplayRow = Note & {
  animate?: boolean;
  editedContent?: string;
};

type AiNotesSectionsProps = {
  notes: AiNoteDisplayRow[];
  onSeek: (seconds: number) => void;
  onUpdateNote: (noteId: string, content: string) => void;
  onAnimationComplete: (noteId: string) => void;
};

const NOTE_CATEGORIES: Array<{ type: NoteType; label: string }> = [
  { type: "theory", label: "Theory" },
  { type: "important", label: "Important" },
  { type: "syntax", label: "Syntax" },
  { type: "logic", label: "Logic" },
];

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function noteLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
}

function EditableNoteContent({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing || !textareaRef.current) return;
    textareaRef.current.focus();
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onChange(trimmed);
  }, [draft, onChange, value]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Escape") return;
      setDraft(value);
      setEditing(false);
    },
    [value],
  );

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          event.target.style.height = "auto";
          event.target.style.height = `${event.target.scrollHeight}px`;
        }}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className="w-full resize-none border-0 bg-transparent p-0 text-xs leading-relaxed text-nh-text outline-none"
        aria-label="Edit AI note"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className="block w-full cursor-text text-left text-xs text-nh-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-nh-teal/50"
      title="Click to edit"
    >
      <ul className="space-y-1.5">
        {noteLines(value).map((line, index) => (
          <li key={`${line}-${index}`} className="flex gap-2 leading-relaxed">
            <span className="shrink-0 text-nh-teal" aria-hidden>
              •
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

export function AiNotesSections({
  notes,
  onSeek,
  onUpdateNote,
  onAnimationComplete,
}: AiNotesSectionsProps) {
  const notesByCategory = useMemo(() => {
    const grouped: Record<NoteType, AiNoteDisplayRow[]> = {
      theory: [],
      important: [],
      syntax: [],
      logic: [],
    };
    const seen: Record<NoteType, Set<string>> = {
      theory: new Set(),
      important: new Set(),
      syntax: new Set(),
      logic: new Set(),
    };

    for (const note of [...notes].sort(
      (left, right) => left.timestamp - right.timestamp,
    )) {
      const type = note.type;
      if (!(type in grouped)) continue;
      const normalized = (note.editedContent ?? note.content)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
      if (!normalized || seen[type].has(normalized)) continue;
      seen[type].add(normalized);
      grouped[type].push(note);
    }

    return grouped;
  }, [notes]);

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <div className="space-y-6">
        {NOTE_CATEGORIES.map(({ type, label }) => {
          const categoryNotes = notesByCategory[type];
          return (
            <section key={type} aria-labelledby={`ai-notes-${type}`}>
              <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-nh-border/70 pb-2">
                <h3
                  id={`ai-notes-${type}`}
                  className="text-[11px] font-bold uppercase tracking-[0.16em] text-nh-muted"
                >
                  {label}
                </h3>
                <span className="font-mono text-[10px] tabular-nums text-nh-dim">
                  {categoryNotes.length}
                </span>
              </div>

              {categoryNotes.length > 0 ? (
                <ol className="space-y-5">
                  {categoryNotes.map((note) => (
                    <li
                      key={note.id}
                      className={note.animate ? "nh-ai-note-enter" : undefined}
                      onAnimationEnd={() => {
                        if (note.animate) onAnimationComplete(note.id);
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => onSeek(note.timestamp)}
                        className="font-mono text-[11px] font-semibold tabular-nums text-nh-muted transition-colors hover:text-nh-teal"
                        title="Jump to this moment in the video"
                      >
                        {formatClock(note.timestamp)}
                      </button>
                      <div className="mt-1.5 pl-3">
                        <EditableNoteContent
                          value={note.editedContent ?? note.content}
                          onChange={(content) => onUpdateNote(note.id, content)}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="pl-3 text-[11px] text-nh-dim">
                  No {label.toLowerCase()} notes yet.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
