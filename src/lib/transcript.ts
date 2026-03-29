/** One caption line from the transcript service. */
export type TranscriptLine = {
  text: string;
  /** Start time in seconds. */
  start: number;
  /** Duration in seconds. */
  duration: number;
};

/** Time-bucketed slice of transcript for revision / chunking. */
export type TranscriptChunk = {
  startSec: number;
  endSec: number;
  text: string;
  chunkIndex: number;
};

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

/**
 * Returns the time chunk that contains `currentSecond`, or `null` if none.
 */
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

/**
 * Concatenates transcript text for every line that has started by `currentSecond`
 * (everything the viewer has been exposed to so far, in timeline order).
 */
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
