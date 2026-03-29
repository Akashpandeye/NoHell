import { NextRequest, NextResponse } from "next/server";

import type { TranscriptLine } from "@/lib/transcript";

function isTranscriptArray(value: unknown): value is TranscriptLine[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      item != null &&
      typeof item === "object" &&
      typeof (item as TranscriptLine).text === "string" &&
      typeof (item as TranscriptLine).start === "number" &&
      typeof (item as TranscriptLine).duration === "number",
  );
}

export async function GET(request: NextRequest) {
  const videoId = request.nextUrl.searchParams.get("videoId");

  if (!videoId?.trim()) {
    return NextResponse.json(
      { error: "Missing videoId query parameter" },
      { status: 400 },
    );
  }

  const base = process.env.TRANSCRIPT_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    return NextResponse.json(
      { error: "Transcript service not configured" },
      { status: 500 },
    );
  }

  const url = `${base}/transcript/${encodeURIComponent(videoId)}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });

    if (res.status === 404) {
      return NextResponse.json(
        { error: "Transcript unavailable", status: 404 },
        { status: 404 },
      );
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: "Transcript unavailable", status: 404 },
        { status: 404 },
      );
    }

    const data: unknown = await res.json();

    if (!isTranscriptArray(data)) {
      return NextResponse.json(
        { error: "Transcript unavailable", status: 404 },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "Transcript unavailable", status: 404 },
      { status: 404 },
    );
  }
}
