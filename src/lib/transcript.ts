/** One normalized caption line. All timing values are in seconds. */
export type TranscriptLine = {
  text: string;
  start: number;
  duration: number;
};

export type TranscriptSource = "external" | "direct";

export type TranscriptErrorCode =
  | "invalid_video_id"
  | "provider_not_configured"
  | "direct_fallback_disabled"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_http_error"
  | "provider_invalid_response"
  | "transcript_not_found"
  | "provider_error"
  | "cache_error";

export type TranscriptError = {
  code: TranscriptErrorCode;
  message: string;
  retryable: boolean;
  provider?: TranscriptSource | "policy" | "cache";
};

export type TranscriptFetchOutcome =
  | { ok: true; lines: TranscriptLine[]; source: TranscriptSource }
  | { ok: false; error: TranscriptError };

export type TranscriptResolution =
  | {
      status: "ready";
      lines: TranscriptLine[];
      source: TranscriptSource;
      cached: boolean;
      fetchedAt: string;
    }
  | {
      status: "fetching";
      retryAfterSeconds: number;
    }
  | {
      status: "unavailable" | "failed";
      error: TranscriptError;
      retryAfter: string | null;
    };

/** Time-bucketed slice of transcript for revision / chunking. */
export type TranscriptChunk = {
  startSec: number;
  endSec: number;
  text: string;
  chunkIndex: number;
};

export const MAX_TRANSCRIPT_LINES = 20_000;
export const MAX_TRANSCRIPT_LINE_CHARS = 4_000;
export const MAX_TRANSCRIPT_TOTAL_CHARS = 2_000_000;
export const MAX_TRANSCRIPT_TIME_SECONDS = 7 * 24 * 60 * 60;

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Accepts provider/cache JSON, removes malformed rows, normalizes whitespace,
 * sorts by start time, and applies hard line/text/time bounds.
 */
export function normalizeTranscriptLines(value: unknown): TranscriptLine[] {
  if (!Array.isArray(value)) return [];

  const candidates: Array<TranscriptLine & { order: number }> = [];
  for (let order = 0; order < value.length; order += 1) {
    const entry = value[order];
    if (typeof entry !== "object" || entry === null) continue;

    const row = entry as Record<string, unknown>;
    const rawText = typeof row.text === "string"
      ? row.text
      : typeof row.content === "string"
        ? row.content
        : "";
    const text = rawText.replace(/\0/g, "").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const start = finiteNumber(row.start)
      ?? finiteNumber(row.start_seconds)
      ?? finiteNumber(row.offset);
    const duration = finiteNumber(row.duration)
      ?? finiteNumber(row.duration_seconds)
      ?? 0;
    if (start === null || start < 0 || start > MAX_TRANSCRIPT_TIME_SECONDS) continue;
    if (duration < 0 || duration > MAX_TRANSCRIPT_TIME_SECONDS) continue;

    candidates.push({
      text: text.slice(0, MAX_TRANSCRIPT_LINE_CHARS),
      start,
      duration,
      order,
    });
  }

  candidates.sort((a, b) => a.start - b.start || a.order - b.order);

  const lines: TranscriptLine[] = [];
  let totalChars = 0;
  for (const candidate of candidates) {
    if (lines.length >= MAX_TRANSCRIPT_LINES) break;
    const remainingChars = MAX_TRANSCRIPT_TOTAL_CHARS - totalChars;
    if (remainingChars <= 0) break;
    const text = candidate.text.slice(0, remainingChars).trim();
    if (!text) break;
    lines.push({ text, start: candidate.start, duration: candidate.duration });
    totalChars += text.length;
  }

  return lines;
}

/**
 * Groups transcript lines into fixed time windows of `chunkMinutes` length.
 * A line is assigned to the chunk where its `start` falls: [i * L, (i+1) * L).
 */
export function splitTranscriptByTime(
  transcript: TranscriptLine[],
  chunkMinutes = 5,
): TranscriptChunk[] {
  if (transcript.length === 0) return [];

  const chunkSec = chunkMinutes * 60;
  const sorted = [...transcript].sort((a, b) => a.start - b.start);

  const maxTimeSec = Math.max(
    ...sorted.map((line) => line.start + line.duration),
    sorted[sorted.length - 1].start,
  );
  const chunkCount = Math.max(1, Math.ceil(maxTimeSec / chunkSec));

  const chunks: TranscriptChunk[] = [];

  for (let i = 0; i < chunkCount; i++) {
    const startSec = i * chunkSec;
    const endSec = (i + 1) * chunkSec;
    const linesInChunk = sorted.filter(
      (line) => line.start >= startSec && line.start < endSec,
    );
    const text = linesInChunk.map((line) => line.text.trim()).join(" ").trim();

    chunks.push({
      startSec,
      endSec,
      text,
      chunkIndex: i,
    });
  }

  return chunks;
}

/** Returns the time chunk that contains `currentSecond`, or `null` if none. */
export function getChunkAtSecond(
  chunks: TranscriptChunk[],
  currentSecond: number,
): TranscriptChunk | null {
  return (
    chunks.find(
      (c) => currentSecond >= c.startSec && currentSecond < c.endSec,
    ) ?? null
  );
}

/** Returns only captions that began within a completed playback range. */
export function getTranscriptTextInRange(
  transcript: TranscriptLine[],
  startSecond: number,
  endSecond: number,
): string {
  if (transcript.length === 0 || endSecond <= startSecond) return "";
  return [...transcript]
    .sort((a, b) => a.start - b.start)
    .filter((line) => line.start >= startSecond && line.start < endSecond)
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function getCumulativeTextUpToSecond(
  transcript: TranscriptLine[],
  currentSecond: number,
): string {
  if (transcript.length === 0) return "";

  const sorted = [...transcript].sort((a, b) => a.start - b.start);
  const parts = sorted
    .filter((line) => line.start <= currentSecond)
    .map((line) => line.text.trim());

  return parts.join(" ").trim();
}
