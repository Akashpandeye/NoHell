import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * Returns `{ sessions_used, plan }` for the signed-in Clerk user.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serverGetUserUsage } = await import("@/lib/server-firestore");
  const usage = await serverGetUserUsage(userId);
  return NextResponse.json(usage);
}
