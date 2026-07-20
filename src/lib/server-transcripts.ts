import "server-only";

import { fetchYouTubeTranscriptLines } from "@/lib/fetch-youtube-transcript";
import { getServerSupabase } from "@/lib/supabase-server";
import {
  normalizeTranscriptLines,
  type TranscriptError,
  type TranscriptErrorCode,
  type TranscriptResolution,
  type TranscriptSource,
} from "@/lib/transcript";

const CLAIM_LEASE_SECONDS = 35;
const TRANSIENT_FAILURE_TTL_MS = 5 * 60 * 1000;
const POLICY_FAILURE_TTL_MS = 15 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 6 * 60 * 60 * 1000;

const ERROR_CODES: ReadonlySet<string> = new Set<TranscriptErrorCode>([
  "invalid_video_id",
  "provider_not_configured",
  "direct_fallback_disabled",
  "provider_timeout",
  "provider_rate_limited",
  "provider_http_error",
  "provider_invalid_response",
  "transcript_not_found",
  "provider_error",
  "cache_error",
]);

type ClaimRow = {
  outcome?: unknown;
  cache_status?: unknown;
  lines?: unknown;
  source?: unknown;
  error_code?: unknown;
  error_message?: unknown;
  error_retryable?: unknown;
  error_provider?: unknown;
  retry_after?: unknown;
  lease_token?: unknown;
  fetched_at?: unknown;
  updated_at?: unknown;
};

function cacheError(message: string): TranscriptError {
  return {
    code: "cache_error",
    message,
    retryable: true,
    provider: "cache",
  };
}

function parseSource(value: unknown): TranscriptSource | null {
  return value === "external" || value === "direct" ? value : null;
}

function parseError(row: ClaimRow): TranscriptError {
  const code = typeof row.error_code === "string" && ERROR_CODES.has(row.error_code)
    ? row.error_code as TranscriptErrorCode
    : "provider_error";
  const provider = row.error_provider === "external"
    || row.error_provider === "direct"
    || row.error_provider === "policy"
    || row.error_provider === "cache"
    ? row.error_provider
    : undefined;
  return {
    code,
    message: typeof row.error_message === "string" && row.error_message.trim()
      ? row.error_message
      : "Transcript retrieval failed.",
    retryable: typeof row.error_retryable === "boolean"
      ? row.error_retryable
      : row.cache_status === "failed",
    provider,
  };
}

function isoString(value: unknown, fallback: string): string {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
  return fallback;
}

function retrySeconds(value: unknown): number {
  if (typeof value !== "string") return 2;
  const remaining = Date.parse(value) - Date.now();
  if (!Number.isFinite(remaining)) return 2;
  return Math.max(1, Math.min(CLAIM_LEASE_SECONDS, Math.ceil(remaining / 1000)));
}

function resolutionFromRow(row: ClaimRow, cached: boolean): TranscriptResolution {
  if (row.cache_status === "ready") {
    const source = parseSource(row.source);
    const lines = normalizeTranscriptLines(row.lines);
    if (!source || lines.length === 0) {
      return {
        status: "failed",
        error: cacheError("The cached transcript is invalid."),
        retryAfter: null,
      };
    }
    const now = new Date().toISOString();
    return {
      status: "ready",
      lines,
      source,
      cached,
      fetchedAt: isoString(row.fetched_at, isoString(row.updated_at, now)),
    };
  }

  if (row.cache_status === "unavailable" || row.cache_status === "failed") {
    return {
      status: row.cache_status,
      error: parseError(row),
      retryAfter: typeof row.retry_after === "string" ? row.retry_after : null,
    };
  }

  return { status: "fetching", retryAfterSeconds: retrySeconds(row.retry_after) };
}

function retryAfterFor(error: TranscriptError, status: "unavailable" | "failed"): string {
  let ttl = status === "unavailable" ? UNAVAILABLE_TTL_MS : TRANSIENT_FAILURE_TTL_MS;
  if (error.code === "provider_not_configured" || error.code === "direct_fallback_disabled") {
    ttl = POLICY_FAILURE_TTL_MS;
  }
  return new Date(Date.now() + ttl).toISOString();
}

async function loadCurrentCache(videoId: string): Promise<TranscriptResolution> {
  const { data, error } = await getServerSupabase()
    .from("video_transcript_cache")
    .select("status, lines, source, error_code, error_message, error_retryable, error_provider, retry_after, lease_expires_at, fetched_at, updated_at")
    .eq("video_id", videoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    return {
      status: "failed",
      error: cacheError("The transcript cache row disappeared."),
      retryAfter: null,
    };
  }
  const row = data as ClaimRow & { status?: unknown; lease_expires_at?: unknown };
  return resolutionFromRow({
    ...row,
    cache_status: row.status,
    retry_after: row.status === "fetching" ? row.lease_expires_at : row.retry_after,
  }, true);
}

/**
 * Resolves a video transcript through the global cache. Only the request holding
 * the database lease calls a provider; concurrent requests receive `fetching`.
 */
export async function resolveVideoTranscript(
  videoId: string,
  options: { forceRetry?: boolean } = {},
): Promise<TranscriptResolution> {
  const { data, error: claimError } = await getServerSupabase()
    .rpc("claim_video_transcript", {
      p_video_id: videoId,
      p_force: options.forceRetry === true,
      p_lease_seconds: CLAIM_LEASE_SECONDS,
    })
    .single();
  if (claimError) throw new Error(claimError.message);

  const claim = (data ?? {}) as ClaimRow;
  if (claim.outcome !== "claimed") {
    return resolutionFromRow(claim, true);
  }

  if (typeof claim.lease_token !== "string") {
    throw new Error("Transcript cache claim did not return a lease token");
  }

  const fetched = await fetchYouTubeTranscriptLines(videoId);
  const failureStatus: "unavailable" | "failed" | null = fetched.ok
    ? null
    : fetched.error.code === "transcript_not_found" || fetched.error.code === "invalid_video_id"
      ? "unavailable"
      : "failed";
  const status = failureStatus ?? "ready";
  const retryAfter = fetched.ok
    ? null
    : retryAfterFor(fetched.error, failureStatus ?? "failed");

  const { data: finalized, error: finalizeError } = await getServerSupabase()
    .rpc("finalize_video_transcript", {
      p_video_id: videoId,
      p_lease_token: claim.lease_token,
      p_status: status,
      p_lines: fetched.ok ? fetched.lines : null,
      p_source: fetched.ok ? fetched.source : null,
      p_error_code: fetched.ok ? null : fetched.error.code,
      p_error_message: fetched.ok ? null : fetched.error.message,
      p_error_retryable: fetched.ok ? null : fetched.error.retryable,
      p_error_provider: fetched.ok ? null : (fetched.error.provider ?? null),
      p_retry_after: retryAfter,
    })
    .single();
  if (finalizeError) throw new Error(finalizeError.message);

  const finalizedRow = (finalized ?? {}) as { updated?: unknown };
  if (finalizedRow.updated !== true) return loadCurrentCache(videoId);

  if (fetched.ok) {
    return {
      status: "ready",
      lines: fetched.lines,
      source: fetched.source,
      cached: false,
      fetchedAt: new Date().toISOString(),
    };
  }
  return { status: failureStatus ?? "failed", error: fetched.error, retryAfter };
}
