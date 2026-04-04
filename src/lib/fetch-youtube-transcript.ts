import { fetchTranscript } from "youtube-transcript";

import type { TranscriptLine } from "@/lib/transcript";

/** Modern desktop Chrome UA — some datacenter blocks are looser than default Node fetch. */
const SERVER_FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * youtube-transcript uses `fetch` for InnerTube + caption XML. Node/Vercel defaults are
 * often blocked; browser-like headers slightly improve success rates.
 */
function youtubeCompatibleFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const h = new Headers(init?.headers);
  if (!h.has("User-Agent")) {
    h.set("User-Agent", SERVER_FETCH_UA);
  }
  if (!h.has("Accept-Language")) {
    h.set("Accept-Language", "en-US,en;q=0.9");
  }
  return fetch(input, {
    ...init,
    headers: h,
    cache: "no-store",
  });
}

/**
 * Fetches caption lines for a YouTube video (shared by `/api/transcript` and session start).
 * In-process call avoids self-HTTP requests that can fail on serverless (e.g. Vercel).
 *
 * Note: YouTube frequently blocks caption requests from cloud IPs. Callers should handle
 * `{ ok: false }` and degrade gracefully (session without AI-from-transcript features).
 */
export async function fetchYouTubeTranscriptLines(
  videoId: string,
): Promise<{ ok: true; lines: TranscriptLine[] } | { ok: false }> {
  const id = videoId.trim();
  if (!id) return { ok: false };

  try {
    const raw = await fetchTranscript(id, { fetch: youtubeCompatibleFetch });
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
