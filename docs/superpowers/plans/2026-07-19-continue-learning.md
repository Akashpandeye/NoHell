# Continue Learning and Session Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the shared NoHell logo on the session screen and let signed-in users resume active or paused sessions from the home page.

**Architecture:** Reuse the existing Supabase session table, row mapper, ownership helper, and session `PATCH` route. Add one authenticated list route for active/paused sessions, render the list in the existing landing component, and persist/restore the current YouTube position through the existing session page.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase server client, Clerk auth, Tailwind CSS, YouTube IFrame API.

## Global Constraints

- Keep all session queries scoped to the authenticated Clerk user.
- Do not add a dependency or a second persistence mechanism.
- Exclude completed and abandoned sessions from the continue list.
- Preserve the existing signed-out landing flow.
- Use the existing `AimMark` component for branding.

---

### Task 1: Add the authenticated unfinished-session list

**Files:**
- Modify: `src/lib/server-firestore.ts`
- Create: `src/app/api/sessions/route.ts`

**Interfaces:**
- Produces `serverGetSessionsForUser(userId: string, limit?: number): Promise<Session[]>`.
- Produces `GET /api/sessions`, returning `{ sessions: Session[] }`.

- [ ] **Step 1: Add the server query helper**

In `src/lib/server-firestore.ts`, add this function after `serverGetSessionForUser`:

```ts
export async function serverGetSessionsForUser(
  userId: string,
  limit = 3,
): Promise<Session[]> {
  const { data, error } = await serverDb()
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["active", "paused"])
    .order("started_at", { ascending: false })
    .limit(Math.max(1, Math.min(10, Math.floor(limit))));
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToSession);
}
```

- [ ] **Step 2: Create the authenticated route**

Create `src/app/api/sessions/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";

import { requireUserId, UnauthorizedError } from "@/lib/server/authz";
import { serverGetSessionsForUser } from "@/lib/server-firestore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: NextRequest) {
  try {
    const userId = await requireUserId();
    const sessions = await serverGetSessionsForUser(userId, 3);
    return NextResponse.json({ sessions });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 503 });
  }
}
```

- [ ] **Step 3: Run the type and lint checks**

Run `npm.cmd run lint` and `& 'node_modules/.bin/tsc.cmd' --noEmit`.

Expected: both commands exit with code 0.

### Task 2: Render the Continue learning section on the home page

**Files:**
- Modify: `src/components/landing/Landing.tsx`

**Interfaces:**
- Consumes `GET /api/sessions` and the existing `Session` type.
- Produces up to three accessible links to `/session/[sessionId]`.

- [ ] **Step 1: Add the session-list state and loader**

Import `useEffect` and `Session`. Add `continueSessions` state and load the list only when `user?.id` is available. Ignore failed requests so the existing landing form remains usable.

```tsx
const [continueSessions, setContinueSessions] = useState<Session[]>([]);

useEffect(() => {
  if (!user?.id) {
    setContinueSessions([]);
    return;
  }

  let cancelled = false;
  void fetch("/api/sessions")
    .then(async (res) => {
      if (!res.ok) return [];
      const data = await res.json() as { sessions?: Session[] };
      return Array.isArray(data.sessions) ? data.sessions : [];
    })
    .then((sessions) => {
      if (!cancelled) setContinueSessions(sessions);
    })
    .catch(() => {
      if (!cancelled) setContinueSessions([]);
    });

  return () => {
    cancelled = true;
  };
}, [user?.id]);
```

- [ ] **Step 2: Add the section below the landing header**

Render the section only when `continueSessions.length > 0`. Use each session's title, goal, `totalWatchSeconds`, and a `Link` to the existing session route. Truncate long titles/goals and include a visible `Resume` label plus an accessible link name.

```tsx
{continueSessions.length > 0 ? (
  <section
    aria-labelledby="continue-learning-heading"
    className="relative z-10 mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6 lg:px-8"
  >
    <div className="mb-3 flex items-end justify-between gap-4">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-nh-dim">
          Pick up where you left off
        </p>
        <h2 id="continue-learning-heading" className="font-display text-xl font-bold text-nh-text">
          Continue learning
        </h2>
      </div>
    </div>
    <div className="grid gap-3 md:grid-cols-3">
      {continueSessions.map((item) => (
        <Link
          key={item.id}
          href={`/session/${item.id}`}
          className="group rounded-2xl border border-nh-border bg-nh-surface p-4 transition-colors hover:border-nh-teal/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nh-teal/50"
          aria-label={`Resume ${item.videoTitle}`}
        >
          <p className="truncate text-sm font-semibold text-nh-text group-hover:text-nh-teal">
            {item.videoTitle}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-nh-muted">
            {item.goal}
          </p>
          <p className="mt-4 font-mono text-[11px] tabular-nums text-nh-dim">
            Resume at {formatClock(item.totalWatchSeconds)}
          </p>
        </Link>
      ))}
    </div>
  </section>
) : null}
```

Add a local `formatClock` helper in the landing component for the displayed saved position.

- [ ] **Step 3: Run the type and lint checks**

Run `npm.cmd run lint` and `& 'node_modules/.bin/tsc.cmd' --noEmit`.

Expected: both commands exit with code 0.

### Task 3: Fix session branding and restore/save playback position

**Files:**
- Modify: `src/app/session/[sessionId]/page.tsx`

**Interfaces:**
- Consumes `session.totalWatchSeconds` from the existing session response.
- Uses the existing `PATCH /api/sessions/[sessionId]` route with `{ totalWatchSeconds }`.

- [ ] **Step 1: Replace the plain session wordmark**

Import `AimMark` from `@/components/brand/AimMark` and change the top-bar home link to a flex link containing the mark and `NoHell`, matching the landing/auth wordmark styling.

- [ ] **Step 2: Seek to the saved position when the player is ready**

Inside the existing YouTube `onReady` handler, clamp `session.totalWatchSeconds` to the player duration and call `seekTo` when the saved position is greater than zero. Add `session?.totalWatchSeconds` to the effect dependencies so the loaded session value is available.

```ts
const savedPosition = Math.max(
  0,
  Math.min(Math.floor(session?.totalWatchSeconds ?? 0), Math.floor(e.target.getDuration())),
);
if (savedPosition > 0) e.target.seekTo(savedPosition, true);
```

- [ ] **Step 3: Persist playback position periodically and on page hide**

Add a `useEffect` that, while the player is ready and the session is not completed/abandoned, sends the current `elapsedRef.current` to the existing `PATCH` route every 10 seconds and from a `pagehide` handler. Keep the request fire-and-forget and avoid blocking navigation.

- [ ] **Step 4: Run the type and lint checks**

Run `npm.cmd run lint` and `& 'node_modules/.bin/tsc.cmd' --noEmit`.

Expected: both commands exit with code 0.

### Task 4: Verify the complete flow

**Files:**
- Verify: `src/app/session/[sessionId]/page.tsx`
- Verify: `src/components/landing/Landing.tsx`
- Verify: `src/app/api/sessions/route.ts`

- [ ] **Step 1: Run the production build**

Run `npm.cmd run build`.

Expected: Next.js compiles, type-checks, and completes page generation with exit code 0.

- [ ] **Step 2: Check the home page while signed in**

Open `/` in the authenticated local browser session. Confirm active/paused sessions render as cards, completed sessions do not render, and clicking `Resume` navigates to the matching session ID.

- [ ] **Step 3: Check the session page branding and resume behavior**

Open `/session/[sessionId]`. Confirm the AimMark is visible in the top-left, wait for the YouTube player, and confirm a previously saved position is restored. Leave the page long enough for a position save, reload it, and confirm the displayed resume position advances.

- [ ] **Step 4: Check the signed-out landing page**

Sign out or use a signed-out browser context. Confirm the Continue learning section is absent and the existing URL/goal start flow remains visible.
