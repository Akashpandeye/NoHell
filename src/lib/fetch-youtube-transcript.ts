import { fetchTranscript } from "youtube-transcript";

import type { TranscriptLine } from "@/lib/transcript";

/** Modern desktop Chrome UA — some datacenter blocks are looser than default Node fetch. */
const SERVER_FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const EXTERNAL_TRANSCRIPT_PROVIDER_URL =
  process.env.YOUTUBE_TRANSCRIPT_PROVIDER_URL?.trim() ?? "";
const EXTERNAL_TRANSCRIPT_PROVIDER_TOKEN =
  process.env.YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN?.trim() ?? "";

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

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeTranscriptLines(value: unknown): TranscriptLine[] {
  if (!Array.isArray(value)) return [];

  const lines: TranscriptLine[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const text =
      typeof row.text === "string"
        ? row.text.trim()
        : typeof row.content === "string"
          ? row.content.trim()
          : "";
    if (!text) continue;

    const start =
      toFiniteNumber(row.start) ??
      toFiniteNumber(row.offset) ??
      toFiniteNumber(row.start_seconds) ??
      0;
    const duration =
      toFiniteNumber(row.duration) ??
      toFiniteNumber(row.duration_seconds) ??
      0;

    lines.push({
      text,
      start: Math.max(0, start),
      duration: Math.max(0, duration),
    });
  }

  return lines;
}

async function fetchTranscriptFromExternalProvider(
  videoId: string,
): Promise<{ ok: true; lines: TranscriptLine[] } | { ok: false }> {
  if (!EXTERNAL_TRANSCRIPT_PROVIDER_URL) return { ok: false };

  try {
    const url = new URL(EXTERNAL_TRANSCRIPT_PROVIDER_URL);
    url.searchParams.set("videoId", videoId);

    const headers = new Headers({
      Accept: "application/json",
      "User-Agent": SERVER_FETCH_UA,
    });
    if (EXTERNAL_TRANSCRIPT_PROVIDER_TOKEN) {
      headers.set(
        "Authorization",
        `Bearer ${EXTERNAL_TRANSCRIPT_PROVIDER_TOKEN}`,
      );
    }

    const res = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false };

    const payload = (await res.json()) as unknown;
    const lines = normalizeTranscriptLines(
      typeof payload === "object" &&
        payload !== null &&
        "lines" in payload &&
        Array.isArray((payload as { lines?: unknown }).lines)
        ? (payload as { lines: unknown[] }).lines
        : payload,
    );

    if (lines.length === 0) return { ok: false };
    return { ok: true, lines };
  } catch {
    return { ok: false };
  }
}

async function fetchTranscriptFromNodeProvider(
  videoId: string,
): Promise<{ ok: true; lines: TranscriptLine[] } | { ok: false }> {
  try {
    const raw = await fetchTranscript(videoId, { fetch: youtubeCompatibleFetch });
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

  const external = await fetchTranscriptFromExternalProvider(id);
  if (external.ok) return external;

  return fetchTranscriptFromNodeProvider(id);
}
