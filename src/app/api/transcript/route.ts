import { NextRequest, NextResponse } from "next/server";

import { fetchYouTubeTranscriptLines } from "@/lib/fetch-youtube-transcript";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Groq / transcript can exceed default hobby timeout; Pro allows up to 60s. */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");

  if (!videoId?.trim()) {
    return NextResponse.json(
      { error: "Missing videoId query parameter" },
      { status: 400 },
    );
  }

  const result = await fetchYouTubeTranscriptLines(videoId);
  if (!result.ok) {
    return NextResponse.json(
      { error: "Transcript unavailable" },
      { status: 404 },
    );
  }

  return NextResponse.json(result.lines);
}
