# Resume Layout and Session Sidebar Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the home page free of session lists while making the in-session session list collapsible and reopenable.

**Architecture:** Reuse the existing `/api/sessions` data and `continueSessions` home query. The landing page keeps one compact resume card; the session page owns a local `sessionsOpen` boolean and renders a persistent toggle control plus the existing sidebar when open.

**Tech Stack:** Next.js, React, TypeScript, Tailwind CSS, Node assertion contract checks.

## Global Constraints

- Do not add dependencies or change session persistence behavior.
- The home page must not render a session list or session sidebar.
- The session sidebar is open by default on desktop and can be hidden and reopened without changing the current session.
- Preserve the existing saved playback position and notes behavior.

---

### Task 1: Add failing UI contracts

**Files:**
- Modify: `tools/notes-summary-contract.mjs`

**Interfaces:**
- Consumes: Existing source-text contract checks.
- Produces: Assertions for the compact home resume entry and collapsible session sidebar.

- [ ] **Step 1: Add assertions for the requested layout behavior**

Add these checks after the existing session page reads:

```js
const landing = readFileSync("src/components/landing/Landing.tsx", "utf8");

assert.match(landing, /href=\{`\/session\/\$\{continueSessions\[0\]!\.id\}`\}/);
assert.doesNotMatch(landing, /Your sessions/);
assert.match(sessionPage, /sessionsOpen/);
assert.match(sessionPage, /setSessionsOpen/);
assert.match(sessionPage, /aria-label=\{sessionsOpen \? "Hide sessions" : "Show sessions"\}/);
```

- [ ] **Step 2: Run the contract check and verify it fails**

Run:

```text
node tools/notes-summary-contract.mjs
```

Expected: FAIL because the session page does not yet define `sessionsOpen` and the toggle label.

### Task 2: Implement the compact home entry and session toggle

**Files:**
- Modify: `src/components/landing/Landing.tsx`
- Modify: `src/app/session/[sessionId]/page.tsx`

**Interfaces:**
- Consumes: Existing `continueSessions`, `runningSessions`, `session`, and `Link` usage.
- Produces: A compact home resume card and a local, reopenable session-sidebar toggle.

- [ ] **Step 1: Keep only the compact resume card on the home page**

Retain the existing single `Link` that targets `continueSessions[0]`. Reduce its wrapper to an upper-left compact block by changing the wrapper classes to:

```tsx
className="group relative z-10 block w-fit max-w-sm px-4 pt-5 focus-visible:outline-none sm:px-6"
```

Keep the existing copy and target session. Do not add any `runningSessions` or mapped session list to `Landing.tsx`.

- [ ] **Step 2: Add sidebar visibility state**

Near the existing `runningSessions` state in the session page, add:

```tsx
const [sessionsOpen, setSessionsOpen] = useState(true);
```

- [ ] **Step 3: Add the persistent sessions toggle**

Inside the session page’s main flex area, before the conditional sidebar, add:

```tsx
{runningSessions.length > 0 ? (
  <button
    type="button"
    onClick={() => setSessionsOpen((open) => !open)}
    aria-label={sessionsOpen ? "Hide sessions" : "Show sessions"}
    aria-expanded={sessionsOpen}
    className="absolute left-3 top-3 z-20 rounded-lg border border-nh-border bg-nh-bg/95 px-2.5 py-1.5 text-xs text-nh-muted shadow-sm transition-colors hover:border-nh-teal/50 hover:text-nh-teal"
  >
    {sessionsOpen ? "Hide sessions" : "Sessions"}
  </button>
) : null}
```

Make the main flex container `relative` so the closed-state reopen control remains anchored to the session workspace.

- [ ] **Step 4: Gate the existing sidebar and add a close control**

Change the sidebar condition to `runningSessions.length > 0 && sessionsOpen`. Add a button in the sidebar header beside the title:

```tsx
<button
  type="button"
  onClick={() => setSessionsOpen(false)}
  aria-label="Hide sessions"
  className="rounded-md px-2 py-1 text-[10px] text-nh-muted transition-colors hover:bg-nh-surface hover:text-nh-teal"
>
  Hide
</button>
```

Wrap the header text and button in a `flex items-start justify-between gap-3` container. Keep the existing session links, notes, and player untouched.

### Task 3: Verify the finished behavior

**Files:**
- Test: `tools/notes-summary-contract.mjs`

**Interfaces:**
- Consumes: Updated landing and session page source.
- Produces: Passing static contracts and a build-safe UI change.

- [ ] **Step 1: Run the focused contract check**

Run:

```text
node tools/notes-summary-contract.mjs
```

Expected: `notes, summary, and running-session contracts: PASS`.

- [ ] **Step 2: Run lint and TypeScript checks**

Run:

```text
npm.cmd run lint
& 'node_modules/.bin/tsc.cmd' --noEmit
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Run the production build with dev stopped**

Stop the local dev server before running:

```text
npm.cmd run build
```

Expected: the Next.js build completes successfully without `routes-manifest.json` or webpack-runtime module errors.
