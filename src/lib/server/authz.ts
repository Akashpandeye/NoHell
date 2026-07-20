import { auth } from "@clerk/nextjs/server";

import { serverGetSessionForUser } from "@/lib/server-firestore";
import type { Session } from "@/types";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

/** Returns the Clerk principal or throws before any private data is queried. */
export async function requireUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  return userId;
}

/**
 * Owner-scoped resource lookup. A missing and a non-owned session are both
 * represented as null so route handlers can return the same 404 response.
 */
export async function getOwnedSession(sessionId: string): Promise<Session | null> {
  const userId = await requireUserId();
  return serverGetSessionForUser(sessionId, userId);
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
