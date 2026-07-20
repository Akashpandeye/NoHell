import { NextRequest, NextResponse } from "next/server";

import { getOwnedSession, isUuid, UnauthorizedError } from "@/lib/server/authz";
import { resolveVideoTranscript } from "@/lib/server-transcripts";
import type { TranscriptResolution } from "@/lib/transcript";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function responseFor(result: TranscriptResolution): NextResponse {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Deprecation: "true",
    Link: '</api/sessions/{sessionId}/transcript>; rel="successor-version"',
  });
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

/** @deprecated Use `/api/sessions/[sessionId]/transcript`. */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId")?.trim() ?? "";
  if (!isUuid(sessionId)) {
    return NextResponse.json(
      { error: "A valid sessionId query parameter is required" },
      { status: 400, headers: { Deprecation: "true" } },
    );
  }

  try {
    const session = await getOwnedSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return responseFor(await resolveVideoTranscript(session.videoId));
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Transcript service is temporarily unavailable" },
      { status: 503 },
    );
  }
}
