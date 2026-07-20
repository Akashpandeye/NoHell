# Session Rail and AI Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the closed sessions control from overlaying the video and retry failed HY3 OpenRouter calls once with NVIDIA Nemotron 3 Ultra.

**Architecture:** Keep both changes in their existing shared locations: the session page owns the sessions rail layout, and the OpenRouter transport owns model selection and retry behavior. Add source-level contract assertions to the existing Node test script because the project does not have a TypeScript unit-test runner.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Node `assert` contract scripts.

## Global Constraints

- Do not add dependencies.
- Preserve `OPENROUTER_MODEL` as the primary model.
- Use `nvidia/nemotron-3-ultra-550b-a55b:free` only after a failed primary request.
- Preserve the user’s unrelated working-tree changes.

---

### Task 1: Keep the closed sessions control in layout flow

**Files:**
- Modify: `src/app/session/[sessionId]/page.tsx:1207-1241`
- Test: `tools/notes-summary-contract.mjs`

**Interfaces:**
- Consumes: `runningSessions`, `sessionsOpen`, and `setSessionsOpen` state in the session page.
- Produces: a 2.5rem in-flow button while the sessions panel is closed.

- [ ] **Step 1: Write the failing contract assertion**

Add this assertion after the existing sessions-control assertions:

```js
assert.match(sessionPage, /w-10 min-w-10 shrink-0/);
assert.doesNotMatch(sessionPage, /absolute left-3 top-3 z-20/);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/notes-summary-contract.mjs`

Expected: an assertion failure because the closed control is currently absolute-positioned.

- [ ] **Step 3: Make the minimal layout change**

Replace the closed sessions button class with:

```tsx
className="flex w-10 min-w-10 shrink-0 cursor-pointer flex-col items-center justify-center gap-1.5 border-r border-nh-teal/30 bg-nh-teal/5 text-nh-teal transition-colors duration-200 hover:bg-nh-teal/10 hover:text-nh-text"
```

Keep the existing button condition, accessibility labels, and book emoji.

- [ ] **Step 4: Run the contract to verify it passes**

Run: `node tools/notes-summary-contract.mjs`

Expected: `notes, summary, and running-session contracts: PASS`.

### Task 2: Add shared OpenRouter model fallback

**Files:**
- Modify: `src/lib/ai/openrouter.ts:11-61`
- Modify: `tools/notes-summary-contract.mjs`

**Interfaces:**
- Consumes: `OPENROUTER_MODEL`, request messages, and completion options.
- Produces: `completeWithOpenRouter(messages, options): Promise<string>` with one fallback retry.

- [ ] **Step 1: Write the failing contract assertion**

Add these assertions to `tools/notes-summary-contract.mjs`:

```js
const openRouter = readFileSync("src/lib/ai/openrouter.ts", "utf8");
assert.match(openRouter, /const FALLBACK_MODEL = "nvidia\/nemotron-3-ultra-550b-a55b:free";/);
assert.match(openRouter, /for \(const candidateModel of \[model, FALLBACK_MODEL\]\)/);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node tools/notes-summary-contract.mjs`

Expected: an assertion failure because the fallback constant and retry loop do not exist.

- [ ] **Step 3: Make the minimal shared retry change**

Define `FALLBACK_MODEL` beside the endpoint constant. Extract the existing `fetch` and response validation into a private `completeWithModel` helper accepting `model`, `messages`, and `options`. Have `completeWithOpenRouter` loop over `[model, FALLBACK_MODEL]`, return the first successful completion, and throw the final error after both attempts fail.

- [ ] **Step 4: Run the contract to verify it passes**

Run: `node tools/notes-summary-contract.mjs`

Expected: `notes, summary, and running-session contracts: PASS`.

### Task 3: Verify affected code

**Files:**
- Verify: `src/app/session/[sessionId]/page.tsx`
- Verify: `src/lib/ai/openrouter.ts`
- Verify: `tools/notes-summary-contract.mjs`

- [ ] **Step 1: Run the complete contract suite**

Run: `npm run test:contracts`

Expected: exit code 0 and all three contract scripts print `PASS`.

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: exit code 0 with no ESLint errors.
