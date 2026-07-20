import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const notesRoute = readFileSync("src/app/api/notes/generate/route.ts", "utf8");
const sessionPage = readFileSync("src/app/session/[sessionId]/page.tsx", "utf8");
const notesSections = readFileSync(
  "src/components/session/AiNotesSections.tsx",
  "utf8",
);
const landing = readFileSync("src/components/landing/Landing.tsx", "utf8");

assert.match(notesRoute, /const timestamp = baseSeconds/);
assert.match(sessionPage, /timestamp: formatClock\(startSec\)/);
assert.match(sessionPage, /\["summary", "Summary"\]/);
assert.match(sessionPage, /\/api\/session\/summary/);
assert.match(landing, /href=\{`\/session\/\$\{continueSessions\[0\]!\.id\}`\}/);
assert.doesNotMatch(landing, /Your sessions/);
assert.match(sessionPage, /sessionsOpen/);
assert.match(sessionPage, /setSessionsOpen/);
assert.match(sessionPage, /aria-label="Show your sessions"/);
assert.match(sessionPage, /aria-label="Hide your sessions"/);
assert.match(sessionPage, /w-10 min-w-10 shrink-0/);
assert.doesNotMatch(sessionPage, /absolute left-3 top-3 z-20/);
assert.match(sessionPage, /<AiNotesSections/);
assert.match(notesSections, /type: "theory", label: "Theory"/);
assert.match(notesSections, /type: "important", label: "Important"/);
assert.match(notesSections, /type: "syntax", label: "Syntax"/);
assert.match(notesSections, /type: "logic", label: "Logic"/);
assert.match(notesSections, /onSeek\(note\.timestamp\)/);
assert.match(notesSections, />\s*•\s*</);
assert.doesNotMatch(notesSections, /rounded-xl/);
assert.ok(
  existsSync("src/app/api/session/summary/route.ts"),
  "summary route is missing",
);

const sessionListRoute = readFileSync("src/app/api/sessions/route.ts", "utf8");
assert.match(sessionListRoute, /serverGetSessionsForUser\(userId\)/);

const openRouter = readFileSync("src/lib/ai/openrouter.ts", "utf8");
assert.match(openRouter, /const FALLBACK_MODEL = "nvidia\/nemotron-3-ultra-550b-a55b:free";/);
assert.match(openRouter, /for \(const candidateModel of \[model, FALLBACK_MODEL\]\)/);

console.log("notes, summary, and running-session contracts: PASS");
