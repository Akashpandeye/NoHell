import { NextResponse } from "next/server";

import { requireUserId, UnauthorizedError } from "@/lib/server/authz";
import { serverGetSessionsForUser } from "@/lib/server-firestore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const sessions = await serverGetSessionsForUser(userId);
    return NextResponse.json({ sessions });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 503 });
  }
}
