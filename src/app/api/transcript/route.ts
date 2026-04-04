import { NextRequest, NextResponse } from "next/server";
import { fetchTranscript } from "youtube-transcript";

import type { TranscriptLine } from "@/lib/transcript";

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");

  if (!videoId?.trim()) {
    return NextResponse.json(
      { error: "Missing videoId query parameter" },
      { status: 400 },
    );
  }

  try {
    const raw = await fetchTranscript(videoId.trim());

    if (!raw || raw.length === 0) {
      return NextResponse.json(
        { error: "Transcript unavailable" },
        { status: 404 },
      );
    }

    const maxOffset = Math.max(...raw.map((e) => e.offset));
    const isMs = maxOffset > 10_000;
    const divisor = isMs ? 1000 : 1;

    const lines: TranscriptLine[] = raw.map((entry) => ({
      text: entry.text ?? "",
      start: (entry.offset ?? 0) / divisor,
      duration: (entry.duration ?? 0) / divisor,
    }));

    return NextResponse.json(lines);
  } catch {
    return NextResponse.json(
      { error: "Transcript unavailable" },
      { status: 404 },
    );
  }
}
