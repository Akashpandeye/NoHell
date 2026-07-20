import { NextRequest, NextResponse } from "next/server";

import { getOwnedSession, isUuid, UnauthorizedError } from "@/lib/server/authz";
import { serverGetNotesForUser } from "@/lib/server-firestore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  try {
    const session = await getOwnedSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const notes = await serverGetNotesForUser(sessionId, session.userId);
    return NextResponse.json({ notes: notes ?? [] });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load notes" }, { status: 503 });
  }
}
