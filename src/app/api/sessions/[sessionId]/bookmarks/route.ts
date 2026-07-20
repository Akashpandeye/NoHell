import { NextRequest, NextResponse } from "next/server";

import { getOwnedSession, isUuid, requireUserId, UnauthorizedError } from "@/lib/server/authz";
import { serverAddBookmarkForUser, serverGetBookmarksForUser } from "@/lib/server-firestore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  try {
    const session = await getOwnedSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const bookmarks = await serverGetBookmarksForUser(sessionId, session.userId);
    return NextResponse.json({ bookmarks: bookmarks ?? [] });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load bookmarks" }, { status: 503 });
  }
}

export async function POST(request: NextRequest, { params }: Context) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  let body: { timestampSeconds?: unknown; label?: unknown };
  try {
    body = await request.json() as { timestampSeconds?: unknown; label?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const timestampSeconds = typeof body.timestampSeconds === "number" && Number.isInteger(body.timestampSeconds) && body.timestampSeconds >= 0
    ? body.timestampSeconds
    : -1;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (timestampSeconds < 0 || !label || label.length > 200) {
    return NextResponse.json({ error: "Invalid bookmark" }, { status: 400 });
  }

  try {
    const userId = await requireUserId();
    const id = await serverAddBookmarkForUser(userId, { sessionId, timestampSeconds, label, createdAt: new Date() });
    if (!id) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ bookmark: { id, sessionId, timestampSeconds, label, createdAt: new Date().toISOString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to save bookmark" }, { status: 503 });
  }
}
