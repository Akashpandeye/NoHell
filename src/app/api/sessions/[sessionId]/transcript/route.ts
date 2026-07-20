import { NextRequest, NextResponse } from "next/server";

import { getOwnedSession, isUuid, UnauthorizedError } from "@/lib/server/authz";
import { resolveVideoTranscript } from "@/lib/server-transcripts";
import type { TranscriptResolution } from "@/lib/transcript";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Context = { params: Promise<{ sessionId: string }> };

function transcriptResponse(result: TranscriptResolution): NextResponse {
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (result.status === "fetching") {
    headers.set("Retry-After", String(result.retryAfterSeconds));
    return NextResponse.json(result, { status: 202, headers });
  }
  if (result.status === "unavailable") {
    return NextResponse.json(result, { status: 404, headers });
  }
  if (result.status === "failed") {
    return NextResponse.json(result, { status: 503, headers });
  }
  return NextResponse.json(result, { status: 200, headers });
}

async function handle(
  _request: NextRequest,
  context: Context,
  forceRetry: boolean,
): Promise<NextResponse> {
  const { sessionId } = await context.params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const session = await getOwnedSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return transcriptResponse(
      await resolveVideoTranscript(session.videoId, { forceRetry }),
    );
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      {
        status: "failed",
        error: {
          code: "cache_error",
          message: "Transcript service is temporarily unavailable.",
          retryable: true,
          provider: "cache",
        },
        retryAfter: null,
      } satisfies TranscriptResolution,
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

/** Returns the cached transcript or atomically claims and fetches it. */
export async function GET(request: NextRequest, context: Context) {
  return handle(request, context, false);
}

/** Explicitly retries a negatively cached transcript; active leases are preserved. */
export async function POST(request: NextRequest, context: Context) {
  return handle(request, context, true);
}
