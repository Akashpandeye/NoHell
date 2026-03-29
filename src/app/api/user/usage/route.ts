import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Returns `{ sessions_used, plan }` for the signed-in Clerk user.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { getUserUsage } = await import("@/lib/usage");
  const usage = await getUserUsage(userId);
  return NextResponse.json(usage);
}
