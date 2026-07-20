import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const revisionRoute = readFileSync(
  "src/app/api/revision/card/route.ts",
  "utf8",
);
const sharedTypes = readFileSync("src/types/index.ts", "utf8");
const sessionPage = readFileSync(
  "src/app/session/[sessionId]/page.tsx",
  "utf8",
);
const transcriptProvider = readFileSync(
  "src/lib/fetch-youtube-transcript.ts",
  "utf8",
);
const transcriptCache = readFileSync(
  "src/lib/server-transcripts.ts",
  "utf8",
);
const ownedTranscriptRoute = readFileSync(
  "src/app/api/sessions/[sessionId]/transcript/route.ts",
  "utf8",
);
const landing = readFileSync("src/components/landing/Landing.tsx", "utf8");

assert.doesNotMatch(revisionRoute, /CONTENT_MAX_CHARS\s*=\s*800/);
assert.match(revisionRoute, /PROMPT_MAX_CHARS/);
assert.match(revisionRoute, /maxTokens:\s*4096/);
assert.match(revisionRoute, /evidence_quote/);
assert.match(revisionRoute, /normalizedTranscript\.includes\(normalizedEvidence\)/);
assert.match(sharedTypes, /quiz\?: TutorialQuiz/);
assert.match(sharedTypes, /correctOptionId: string/);
assert.match(sessionPage, /<RevisionOverlay/);
assert.match(sessionPage, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/transcript/);
assert.doesNotMatch(sessionPage, /\/api\/transcript\?videoId=/);
assert.doesNotMatch(landing, /sessionStorage/);

assert.match(transcriptProvider, /EXTERNAL_PROVIDER_TIMEOUT_MS/);
assert.match(transcriptProvider, /DIRECT_PROVIDER_TIMEOUT_MS/);
assert.match(transcriptProvider, /YOUTUBE_TRANSCRIPT_ALLOW_DIRECT_FALLBACK/);
assert.match(transcriptProvider, /process\.env\.VERCEL === "1"/);
assert.match(transcriptCache, /claim_video_transcript/);
assert.match(transcriptCache, /finalize_video_transcript/);
assert.match(ownedTranscriptRoute, /params: Promise<\{ sessionId: string \}>/);
assert.match(ownedTranscriptRoute, /getOwnedSession\(sessionId\)/);
assert.match(ownedTranscriptRoute, /export async function POST/);

for (const path of [
  "supabase/migrations/202607200001_video_transcript_cache.sql",
  "tools/transcript-proxy/app.py",
  "tools/transcript-proxy/requirements.txt",
  "tools/transcript-proxy/Dockerfile",
  "tools/transcript-proxy/tests/test_app.py",
  "render.yaml",
]) {
  assert.ok(existsSync(path), `${path} is missing`);
}

console.log("revision, quiz, and transcript reliability contracts: PASS");
