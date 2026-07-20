import { NextRequest, NextResponse } from "next/server";

import { isUuid, requireUserId, UnauthorizedError } from "@/lib/server/authz";
import { serverDeleteBookmarkForUser, serverUpdateBookmarkLabelForUser } from "@/lib/server-firestore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ sessionId: string; bookmarkId: string }> };

export async function DELETE(_request: NextRequest, { params }: Context) {
  const { sessionId, bookmarkId } = await params;
  if (!isUuid(sessionId) || !isUuid(bookmarkId)) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  try {
    const userId = await requireUserId();
    const deleted = await serverDeleteBookmarkForUser(bookmarkId, sessionId, userId);
    if (!deleted) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to delete bookmark" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const { sessionId, bookmarkId } = await params;
  if (!isUuid(sessionId) || !isUuid(bookmarkId)) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  let body: { label?: unknown };
  try {
    body = await request.json() as { label?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 200) return NextResponse.json({ error: "Invalid bookmark label" }, { status: 400 });
  try {
    const userId = await requireUserId();
    const updated = await serverUpdateBookmarkLabelForUser(bookmarkId, sessionId, userId, label);
    if (!updated) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
    return NextResponse.json({ ok: true, label });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to update bookmark" }, { status: 503 });
  }
}
