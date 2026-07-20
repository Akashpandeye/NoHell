import { NextRequest, NextResponse } from "next/server";

import { isUuid, requireUserId, UnauthorizedError } from "@/lib/server/authz";
import { serverUpdateNoteContentForUser } from "@/lib/server-firestore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string; noteId: string }> };

export async function PATCH(request: NextRequest, { params }: Context) {
  const { sessionId, noteId } = await params;
  if (!isUuid(sessionId) || !isUuid(noteId)) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  let body: { content?: unknown };
  try {
    body = await request.json() as { content?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content || content.length > 10_000) {
    return NextResponse.json({ error: "Note content must be 1 to 10,000 characters" }, { status: 400 });
  }

  try {
    const userId = await requireUserId();
    const updated = await serverUpdateNoteContentForUser(noteId, sessionId, userId, content);
    if (!updated) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    return NextResponse.json({ ok: true, content });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to update note" }, { status: 503 });
  }
}
