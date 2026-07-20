import {
  fetchTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";

import {
  normalizeTranscriptLines,
  type TranscriptError,
  type TranscriptFetchOutcome,
} from "@/lib/transcript";

const SERVER_FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const EXTERNAL_PROVIDER_TIMEOUT_MS = 12_000;
const DIRECT_PROVIDER_TIMEOUT_MS = 12_000;

function providerConfig() {
  return {
    url: process.env.YOUTUBE_TRANSCRIPT_PROVIDER_URL?.trim() ?? "",
    token: process.env.YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN?.trim() ?? "",
  };
}

function error(
  code: TranscriptError["code"],
  message: string,
  retryable: boolean,
  provider: NonNullable<TranscriptError["provider"]>,
): TranscriptError {
  return { code, message, retryable, provider };
}

function directFallbackAllowed(): boolean {
  const configured = process.env.YOUTUBE_TRANSCRIPT_ALLOW_DIRECT_FALLBACK
    ?.trim()
    .toLowerCase();
  if (configured === "true" || configured === "1" || configured === "yes") return true;
  if (configured === "false" || configured === "0" || configured === "no") return false;

  return !(process.env.NODE_ENV === "production" && process.env.VERCEL === "1");
}

function extractProviderLines(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  const row = payload as Record<string, unknown>;
  if (Array.isArray(row.lines)) return row.lines;
  if (Array.isArray(row.transcript)) return row.transcript;
  return payload;
}

async function fetchTranscriptFromExternalProvider(
  videoId: string,
): Promise<TranscriptFetchOutcome | null> {
  const config = providerConfig();
  if (!config.url) return null;

  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    return {
      ok: false,
      error: error(
        "provider_not_configured",
        "The external transcript provider URL is invalid.",
        false,
        "external",
      ),
    };
  }
  url.searchParams.set("videoId", videoId);

  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": SERVER_FETCH_UA,
  });
  if (config.token) headers.set("Authorization", `Bearer ${config.token}`);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(EXTERNAL_PROVIDER_TIMEOUT_MS),
    });

    if (response.status === 404 || response.status === 410) {
      return {
        ok: false,
        error: error(
          "transcript_not_found",
          "No transcript is available for this video.",
          false,
          "external",
        ),
      };
    }
    if (response.status === 429) {
      return {
        ok: false,
        error: error(
          "provider_rate_limited",
          "The external transcript provider is rate limited.",
          true,
          "external",
        ),
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: error(
          "provider_http_error",
          `The external transcript provider returned HTTP ${response.status}.`,
          response.status >= 500,
          "external",
        ),
      };
    }

    const lines = normalizeTranscriptLines(
      extractProviderLines(await response.json() as unknown),
    );
    if (lines.length === 0) {
      return {
        ok: false,
        error: error(
          "provider_invalid_response",
          "The external transcript provider returned no valid caption lines.",
          true,
          "external",
        ),
      };
    }
    return { ok: true, lines, source: "external" };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "TimeoutError") {
      return {
        ok: false,
        error: error(
          "provider_timeout",
          "The external transcript provider timed out.",
          true,
          "external",
        ),
      };
    }
    return {
      ok: false,
      error: error(
        "provider_error",
        "The external transcript provider request failed.",
        true,
        "external",
      ),
    };
  }
}

function directProviderError(cause: unknown): TranscriptError {
  if (
    cause instanceof YoutubeTranscriptDisabledError
    || cause instanceof YoutubeTranscriptNotAvailableError
    || cause instanceof YoutubeTranscriptNotAvailableLanguageError
    || cause instanceof YoutubeTranscriptVideoUnavailableError
  ) {
    return error(
      "transcript_not_found",
      "No transcript is available for this video.",
      false,
      "direct",
    );
  }
  if (cause instanceof YoutubeTranscriptTooManyRequestError) {
    return error(
      "provider_rate_limited",
      "YouTube rate limited the transcript request.",
      true,
      "direct",
    );
  }
  if (cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError")) {
    return error(
      "provider_timeout",
      "The direct YouTube transcript request timed out.",
      true,
      "direct",
    );
  }
  return error(
    "provider_error",
    "The direct YouTube transcript request failed.",
    true,
    "direct",
  );
}

async function fetchTranscriptFromNodeProvider(
  videoId: string,
): Promise<TranscriptFetchOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECT_PROVIDER_TIMEOUT_MS);

  const compatibleFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) headers.set("User-Agent", SERVER_FETCH_UA);
    if (!headers.has("Accept-Language")) headers.set("Accept-Language", "en-US,en;q=0.9");
    return fetch(input, {
      ...init,
      headers,
      signal: controller.signal,
      cache: "no-store",
    });
  };

  try {
    const raw = await fetchTranscript(videoId, { fetch: compatibleFetch });
    if (!raw?.length) {
      return {
        ok: false,
        error: error(
          "transcript_not_found",
          "No transcript is available for this video.",
          false,
          "direct",
        ),
      };
    }

    const durations = raw
      .map((entry) => entry.duration)
      .filter((value) => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    const medianDuration = durations.length > 0
      ? durations[Math.floor(durations.length / 2)]
      : 0;
    const divisor = medianDuration > 100 ? 1000 : 1;
    const lines = normalizeTranscriptLines(raw.map((entry) => ({
      text: entry.text,
      start: entry.offset / divisor,
      duration: entry.duration / divisor,
    })));

    if (lines.length === 0) {
      return {
        ok: false,
        error: error(
          "provider_invalid_response",
          "YouTube returned no valid caption lines.",
          true,
          "direct",
        ),
      };
    }
    return { ok: true, lines, source: "direct" };
  } catch (cause) {
    return { ok: false, error: directProviderError(cause) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Fetches normalized captions, preferring the configured external provider. */
export async function fetchYouTubeTranscriptLines(
  videoId: string,
): Promise<TranscriptFetchOutcome> {
  const id = videoId.trim();
  if (!YOUTUBE_VIDEO_ID.test(id)) {
    return {
      ok: false,
      error: error(
        "invalid_video_id",
        "A valid YouTube video ID is required.",
        false,
        "policy",
      ),
    };
  }

  const external = await fetchTranscriptFromExternalProvider(id);
  if (external?.ok) return external;

  if (!directFallbackAllowed()) {
    if (external && !external.error.retryable) return external;
    return {
      ok: false,
      error: error(
        external ? "direct_fallback_disabled" : "provider_not_configured",
        external
          ? "The external provider failed and direct YouTube fallback is disabled."
          : "No transcript provider is configured and direct YouTube fallback is disabled.",
        Boolean(external),
        "policy",
      ),
    };
  }

  const direct = await fetchTranscriptFromNodeProvider(id);
  if (direct.ok) return direct;
  if (direct.error.code === "transcript_not_found") return direct;
  return external && !external.error.retryable ? external : direct;
}
