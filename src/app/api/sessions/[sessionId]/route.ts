import { NextRequest, NextResponse } from "next/server";

import { getOwnedSession, isUuid, UnauthorizedError } from "@/lib/server/authz";
import { serverUpdateSessionForUser } from "@/lib/server-firestore";
import type { SessionStatus } from "@/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SESSION_STATUSES: ReadonlySet<string> = new Set(["active", "paused", "completed", "abandoned"]);

type Context = { params: Promise<{ sessionId: string }> };

export async function GET(_request: NextRequest, { params }: Context) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  try {
    const session = await getOwnedSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load session" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  const { sessionId } = await params;
  if (!isUuid(sessionId)) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const status = typeof body.status === "string" && SESSION_STATUSES.has(body.status)
    ? body.status as SessionStatus
    : undefined;
  const totalWatchSeconds = typeof body.totalWatchSeconds === "number" && Number.isInteger(body.totalWatchSeconds) && body.totalWatchSeconds >= 0
    ? body.totalWatchSeconds
    : undefined;
  const endedAt = typeof body.endedAt === "string" && !Number.isNaN(Date.parse(body.endedAt))
    ? new Date(body.endedAt)
    : undefined;

  if (!status && totalWatchSeconds === undefined && endedAt === undefined) {
    return NextResponse.json({ error: "No valid session changes supplied" }, { status: 400 });
  }

  try {
    const { requireUserId } = await import("@/lib/server/authz");
    const userId = await requireUserId();
    const updated = await serverUpdateSessionForUser(sessionId, userId, { status, totalWatchSeconds, endedAt });
    if (!updated) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to update session" }, { status: 503 });
  }
}
