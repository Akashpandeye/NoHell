import { fetchTranscript } from "youtube-transcript";

import type { TranscriptLine } from "@/lib/transcript";

/**
 * Fetches caption lines for a YouTube video (shared by `/api/transcript` and session start).
 * In-process call avoids self-HTTP requests that can fail on serverless (e.g. Vercel).
 */
export async function fetchYouTubeTranscriptLines(
  videoId: string,
): Promise<{ ok: true; lines: TranscriptLine[] } | { ok: false }> {
  const id = videoId.trim();
  if (!id) return { ok: false };

  try {
    const raw = await fetchTranscript(id);
    if (!raw || raw.length === 0) return { ok: false };

    const maxOffset = Math.max(...raw.map((e) => e.offset));
    const isMs = maxOffset > 10_000;
    const divisor = isMs ? 1000 : 1;

    const lines: TranscriptLine[] = raw.map((entry) => ({
      text: entry.text ?? "",
      start: (entry.offset ?? 0) / divisor,
      duration: (entry.duration ?? 0) / divisor,
    }));

    return { ok: true, lines };
  } catch {
    return { ok: false };
  }
}
