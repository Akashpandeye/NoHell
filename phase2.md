# Phase 2 — Notes, Revision Cards, Preloading, and Multilingual Learning

## Overview

Phase 2 improves the learning-session pipeline in four areas:

1. Make note capture reliable and persist both AI-generated and user-written notes.
2. Display revision cards every 10 minutes with no generation delay at the checkpoint.
3. Pre-generate notes, quizzes, summaries, and recall material in the background.
4. Support Hindi videos while producing notes, quizzes, summaries, and revision content in English.

This document describes the proposed implementation. It does not represent completed work.

---

## Current State

### AI notes

AI notes are already generated after each completed 60-second section of naturally watched video.

Current flow:

1. The session page tracks the current playback position.
2. After a completed 60-second segment, it extracts the corresponding transcript lines.
3. It calls `POST /api/notes/generate`.
4. The API generates categorized notes.
5. Generated notes are inserted into the Supabase `notes` table.
6. The response is immediately added to the AI Notes sidebar.
7. Existing notes are loaded again when the session is reopened.

Relevant files:

- `src/app/session/[sessionId]/page.tsx`
- `src/app/api/notes/generate/route.ts`
- `src/app/api/sessions/[sessionId]/notes/route.ts`
- `src/lib/server-firestore.ts`
- `src/components/session/AiNotesSections.tsx`
- `supabase-schema.sql`

### My Notes

The manually entered **My Notes** content currently exists only in React state. It is not sent to an API or saved in the database. Refreshing the page or reopening the session loses this content.

### Revision cards

Revision cards currently use a three-minute window:

```ts
const REVISION_WINDOW_SECONDS = 3 * 60;
```

Once the learner crosses a completed window, the application calls `POST /api/revision/card`. The API generates a revision card and an optional quiz in the same request.

The video currently pauses only after generation finishes, which means the checkpoint appears later than the intended playback boundary.

Revision cards, quiz answers, and quiz attempts are not currently persisted.

### Transcript support

The transcript system currently retrieves YouTube caption tracks. It does not transcribe raw audio.

The external transcript proxy supports a prioritized list of caption languages, but currently defaults to English. Hindi-only videos may fail unless Hindi is added to the preferred language configuration.

The transcript cache is keyed only by YouTube video ID. It does not store the requested language, actual source language, caption type, or translation state.

---

## Goals

### Functional goals

- Reliably generate and save AI notes for watched transcript segments.
- Save manually written My Notes for each session.
- Display a revision checkpoint after every 10 minutes of watched content.
- Have revision cards and quizzes ready before the checkpoint is reached.
- Restore revision cards after refresh or reconnection.
- Avoid duplicate notes and cards across retries, reloads, and multiple tabs.
- Generate English learning material from Hindi source content.
- Support Unicode source evidence in quiz validation.
- Clearly show preparation, ready, failed, and retry states in the UI.
- Eventually support speech-to-text for videos without usable captions.

### Non-goals for the initial implementation

- Generating every artifact for the entire video immediately after session creation.
- Showing guessed or placeholder educational content before the model responds.
- Translating code, commands, API names, identifiers, or technical tokens.
- Replacing the current caption pipeline before a speech-to-text fallback is necessary.

---

## Phase 2A — Reliable AI Notes

### 1. Add durable segment-generation records

Create a server-owned generation table rather than relying only on component-local refs and sets.

Suggested table: `session_generation_segments`

Suggested fields:

```text
id
session_id
artifact_type
start_second
end_second
status
source_language
output_language
prompt_version
model_version
attempt_count
last_error
generated_at
created_at
updated_at
```

Suggested artifact types:

```text
notes
revision_card
summary
recall_questions
```

Suggested statuses:

```text
pending
generating
ready
failed
```

Add a unique identity covering:

```text
session_id
artifact_type
start_second
end_second
prompt_version
output_language
```

This prevents duplicate work across:

- Multiple browser tabs.
- Component remounts.
- Network retries.
- Concurrent requests.
- Browser reloads.
- Repeated checkpoint processing.

### 2. Make note insertion atomic

The current implementation inserts generated notes one at a time. A failure halfway through can leave a partially saved minute.

Change note generation so that:

1. The server atomically claims the segment.
2. The model generates the complete note batch.
3. All notes are validated.
4. The complete batch is inserted in one transaction or Supabase RPC.
5. The segment is marked `ready` in the same transaction.
6. A failed batch leaves the segment retryable instead of partially complete.

### 3. Track segment identity on notes

Add enough metadata to determine which generation produced a note:

```text
segment_id
source
prompt_version
```

Suggested `source` values:

```text
ai
user
```

This allows AI notes and manually written notes to share a consistent data model if desired, while still remaining distinguishable.

### 4. Improve note-generation state

Replace the single `capturingNotes` boolean with job-aware state.

For example:

```ts
Record<string, "pending" | "generating" | "ready" | "failed">
```

Each minute should have its own status so one completed request cannot incorrectly hide another request that is still running.

### 5. Improve optimistic note editing

Keep immediate local note edits, but add:

- A saving state.
- Response validation.
- Rollback when the PATCH request fails.
- A visible retry action.
- Protection against stale concurrent edits if necessary.

### 6. Support partial final segments

Currently, a learner who watches less than 60 seconds receives no AI notes.

When a session ends, generate notes for the remaining watched interval if it contains enough meaningful transcript content.

Example:

```text
Last completed note boundary: 04:00
Session ended at: 04:38
Generate notes for: 04:00–04:38
```

---

## Phase 2B — Persist My Notes

### Recommended storage

Use either:

1. A dedicated `session_user_notes` table with one document per session, or
2. Rows in the existing `notes` table with `source = user`.

A dedicated document is preferable if My Notes remains one free-form textarea.

Suggested fields:

```text
session_id
user_id
content
version
created_at
updated_at
```

Add a unique constraint on `session_id`.

### API behavior

Add an authenticated session-owned endpoint, for example:

```text
GET   /api/sessions/[sessionId]/my-notes
PUT   /api/sessions/[sessionId]/my-notes
```

The endpoint should:

- Verify Clerk authentication.
- Verify that the session belongs to the user.
- Validate the content length.
- Upsert the document.
- Return the saved version and timestamp.

### Client behavior

- Load My Notes independently from AI notes.
- Update local state immediately as the learner types.
- Debounce saves, for example by 500–1000 ms.
- Show `Saving…`, `Saved`, or `Could not save`.
- Flush pending content on page visibility change or session end.
- Avoid overwriting newer server content from another tab.

---

## Phase 2C — Ten-Minute Revision Cards

### 1. Change the revision interval

Replace the three-minute revision interval with 10 minutes:

```ts
const REVISION_WINDOW_SECONDS = 10 * 60;
```

Windows become:

```text
00:00–10:00
10:00–20:00
20:00–30:00
...
```

### 2. Do not generate at the boundary

A direct constant change is not sufficient because the current flow begins generation only after the learner reaches the boundary.

Instead:

1. Begin preparing the first card around 08:30–09:00.
2. Generate from transcript content that the learner has actually watched.
3. Persist the card as soon as it is ready.
4. At exactly 10:00, pause playback.
5. Fetch and display the prepared card immediately.
6. Start preparing the next card as the learner approaches 20:00.

### 3. Preserve watch-based behavior

Pre-generation should not assume that the learner watched all preceding content merely because a complete transcript exists.

The card should be based on:

- Verified watched position.
- Naturally watched intervals.
- Existing seek behavior.
- Any future watched-range tracking.

If the learner skips most of a 10-minute window, the application should not generate a card that implies they studied the skipped material.

### 4. Persist revision cards

Add a `revision_cards` table.

Suggested fields:

```text
id
session_id
segment_id
start_second
end_second
title
summary
key_points
quiz_json
status
generated_at
served_at
created_at
updated_at
```

Persist generation separately from presentation:

- `generated_at` means the artifact is ready.
- `served_at` means it was shown to the learner.

This allows:

- Restoration after refresh.
- Later review.
- Retry after interrupted sessions.
- Distinguishing generated cards from completed checkpoints.

### 5. Persist quiz attempts

Add a `quiz_attempts` table.

Suggested fields:

```text
id
revision_card_id
session_id
user_id
selected_option
correct_option
is_correct
answered_at
created_at
```

This enables recap statistics and later revision recommendations.

### 6. Exact checkpoint behavior

At the 10-minute boundary:

- Pause playback immediately.
- If the card is `ready`, display it.
- If the card is still `generating`, display a short preparation state.
- If generation failed, show retry and resume options.
- Do not continue playback for model latency and then pause late.

### 7. Seeking and reload behavior

Do not permanently mark a revision window processed solely because the learner reloaded at a later playback position.

Use persisted data to determine:

- Whether a card exists.
- Whether it was served.
- Whether its quiz was answered.
- Whether the checkpoint should be restored.

Forward seeking should not silently mark ungenerated cards complete.

---

## Phase 2D — Optimistic Preloading

### Principle

Generated educational content cannot be truthfully displayed before the model produces it. The optimistic behavior should concern status and layout, not fabricated content.

### Notes sidebar placeholders

Create a stable slot for each segment:

```text
03:00–04:00
Preparing your notes…
```

Replace the placeholder with persisted notes when the segment becomes `ready`.

On failure:

```text
Notes could not be prepared.
Retry
```

### Revision placeholders

Before a checkpoint:

```text
Next revision checkpoint: 10:00
Question ready
```

If still processing:

```text
Next revision checkpoint: 10:00
Preparing question…
```

### Initial session loading

The current page waits for several requests before rendering the session experience. Split loading into independent states:

1. Session metadata and player shell.
2. Transcript readiness.
3. AI notes.
4. My Notes.
5. Bookmarks.
6. Active-session rail.
7. Artifact-generation status.

Recommended behavior:

- Render the player as soon as the session is available.
- Show transcript loading independently.
- Show notes sidebar skeletons independently.
- Do not tie generation to whether the sidebar is open.
- Do not block the complete page on the active-session rail.

### Generation insertion points

#### After transcript readiness

- Create generation segment metadata.
- Start the first relevant note job.
- Prepare only near-term artifacts rather than the entire video.

#### During playback

- Use the existing player-position polling to schedule upcoming work.
- At 45–50 seconds into a minute, prepare the next note job state.
- Finalize the minute when it has actually been watched.
- At 08:30–09:00 into each revision interval, prepare the upcoming card.

#### Before session end

- Pre-generate likely recap material from persisted notes while the learner is still watching.
- At session end, finalize using the latest notes instead of beginning the entire recall-generation request from zero.

### Server-owned orchestration

The server should own generation claims and idempotency:

1. Client requests a segment artifact.
2. Server atomically claims it.
3. Duplicate requests receive its current status.
4. Model output is generated and validated.
5. Artifact and segment status are committed atomically.
6. Client polls or subscribes for completion.

This should follow the same general lease-and-cache pattern already used by the transcript resolution system.

### Job delivery options

Implementation can begin with authenticated polling:

```text
POST /api/sessions/[sessionId]/artifacts/prepare
GET  /api/sessions/[sessionId]/artifacts/status
```

A later implementation may use Supabase Realtime or another queue/worker system. The data model should not depend on a particular delivery mechanism.

---

## Phase 2E — Hindi Source to English Learning Material

### Supported initial case

The first multilingual target should be:

```text
Hindi video with a usable Hindi caption track
→ timed Hindi transcript
→ English notes, quizzes, summaries, and recall questions
```

### 1. Configure caption priority

Configure the transcript proxy with:

```env
YT_TRANSCRIPT_LANGUAGES=hi,en
```

This should mean:

1. Prefer Hindi captions.
2. Fall back to English captions.
3. Return the selected track and its language metadata.

The exact order should remain configurable rather than hard-coded globally.

### 2. Pass language preference explicitly

The direct `youtube-transcript` fallback supports a `lang` option but the current call does not pass one.

Update transcript resolution so that:

- Requested caption languages are explicit.
- Selected language is deterministic.
- Direct and proxy providers follow the same language contract.
- Provider results identify the actual selected track language.

### 3. Store transcript language metadata

Extend transcript data with fields such as:

```text
source_language
requested_languages
provider
track_type
is_auto_generated
is_translated
transcription_version
```

Suggested track types:

```text
manual_caption
auto_caption
speech_to_text
translated_caption
```

### 4. Fix transcript cache identity

The current cache is keyed only by `video_id`. That is insufficient for multilingual transcripts.

Use an identity that accounts for at least:

```text
video_id
source_language
track_type
transcription_version
```

Alternatively, store multiple transcript variants under one video record.

Changing the language preference must not continue returning an old cached English transcript when Hindi was requested.

### 5. Add an explicit generation language contract

Every generation route should receive source and output language metadata.

Suggested instruction:

```text
SOURCE_LANGUAGE: Hindi
OUTPUT_LANGUAGE: English

Produce all learner-facing content in natural English.
Translate concepts faithfully from the source transcript.
Preserve code, commands, identifiers, API names, library names, filenames,
mathematical notation, and technical terms exactly when appropriate.
Ground every claim in the supplied source transcript.
Do not add information that is not supported by the transcript.
```

Apply this contract to:

- AI notes.
- Revision cards.
- Revision quizzes.
- Session summaries.
- End-of-session recall questions.
- Future exports and recap content.

### 6. Preserve source-language evidence

For quizzes generated from Hindi content, learner-facing fields should be English:

- Question.
- Options.
- Explanation.

Grounding should reference the original Hindi transcript using either:

- Exact source-language evidence quotes, or preferably
- Stable transcript line IDs.

Recommended output shape:

```json
{
  "question": "What was the main reason given for using this method?",
  "options": ["Option A", "Option B", "Option C", "Option D"],
  "correctIndex": 1,
  "explanation": "The speaker explains that...",
  "sourceLineIds": [143, 144, 145]
}
```

Line IDs are preferable because translated English evidence cannot exactly match a Hindi source string.

### 7. Fix Unicode quiz validation

The current revision quiz evidence normalizer keeps mostly ASCII characters. Devanagari text can normalize to an empty or very short value, causing valid Hindi-grounded quizzes to be discarded.

Replace ASCII-only normalization with one of the following:

1. Unicode-aware normalization using Unicode letters and numbers.
2. Transcript-line ID validation.
3. A hybrid approach that validates line IDs and optionally checks the quote.

Recommended approach: transcript-line IDs.

Validation should confirm that:

- Referenced lines belong to the requested session transcript.
- Referenced lines fall inside the revision window.
- The evidence contains enough meaningful source text.
- The English explanation is consistent with those lines.

---

## Phase 2F — Audio Transcription Fallback

### Current limitation

The existing implementation retrieves YouTube caption tracks. It does not convert raw Hindi audio into text.

Videos without captions therefore require a separate speech-to-text pipeline.

### Proposed fallback flow

```text
YouTube video
  → retrieve preferred caption track
  → if no usable captions are available
  → obtain audio through an authorized server-side process
  → detect spoken language
  → transcribe into timed source-language segments
  → cache the timed transcript
  → generate English learning artifacts
```

### Requirements

- Use an authorized audio-access method and comply with platform terms.
- Use a speech-to-text provider that supports Hindi and timestamps.
- Preserve the original Hindi transcript.
- Record detected language and confidence.
- Record provider and transcription version.
- Keep transcription separate from translation.
- Avoid retranscribing the same video unnecessarily.
- Expose clear errors when audio transcription is unavailable.

### Recommended rollout

Treat audio transcription as a later subphase after caption-based Hindi support is reliable.

Initial multilingual delivery should support Hindi caption tracks first.

---

## Data Model Proposal

### `session_generation_segments`

```text
id uuid primary key
session_id text not null
artifact_type text not null
start_second integer not null
end_second integer not null
status text not null
source_language text
output_language text not null default 'en'
prompt_version text not null
model_version text
attempt_count integer not null default 0
last_error text
generated_at timestamptz
created_at timestamptz not null
updated_at timestamptz not null
```

Unique constraint:

```text
(session_id, artifact_type, start_second, end_second, prompt_version, output_language)
```

### `revision_cards`

```text
id uuid primary key
session_id text not null
segment_id uuid not null
title text
summary text not null
key_points jsonb not null
quiz_json jsonb
generated_at timestamptz not null
served_at timestamptz
created_at timestamptz not null
updated_at timestamptz not null
```

### `quiz_attempts`

```text
id uuid primary key
revision_card_id uuid not null
session_id text not null
user_id text not null
selected_option integer not null
correct_option integer not null
is_correct boolean not null
answered_at timestamptz not null
created_at timestamptz not null
```

### `session_user_notes`

```text
session_id text primary key
user_id text not null
content text not null default ''
version integer not null default 1
created_at timestamptz not null
updated_at timestamptz not null
```

### Transcript metadata additions

```text
source_language
requested_languages
track_type
provider
is_auto_generated
is_translated
transcription_version
```

---

## API Proposal

### Artifact preparation

```text
POST /api/sessions/[sessionId]/artifacts/prepare
```

Example request:

```json
{
  "artifactType": "revision_card",
  "startSecond": 0,
  "endSecond": 600,
  "sourceLanguage": "hi",
  "outputLanguage": "en"
}
```

The response should return the existing or newly claimed artifact status rather than blindly starting duplicate work.

### Artifact status

```text
GET /api/sessions/[sessionId]/artifacts/status
```

Optional filters:

```text
artifactType
startSecond
endSecond
```

### My Notes

```text
GET /api/sessions/[sessionId]/my-notes
PUT /api/sessions/[sessionId]/my-notes
```

### Revision attempt

```text
POST /api/sessions/[sessionId]/revision-cards/[cardId]/attempts
```

All endpoints must authenticate the user and verify session ownership.

---

## UI States

### AI note segment

```text
idle
pending
generating
ready
failed
```

### Revision checkpoint

```text
upcoming
preparing
ready
active
answered
failed
```

### My Notes

```text
loading
saved
saving
save_failed
```

### Transcript

```text
resolving
ready
failed
unsupported_language
no_captions
transcribing_audio
```

---

## Error Handling and Recovery

### Notes

- Return the current segment status for duplicate requests.
- Retry failed jobs with bounded attempt counts.
- Do not mark partially inserted batches as complete.
- Show retry controls for failed sidebar segments.

### Revision cards

- Pause at the exact boundary even if generation is incomplete.
- Show a preparation state while waiting.
- Allow the learner to retry or resume.
- Restore an active checkpoint after reload.

### My Notes

- Keep unsaved local content if a request fails.
- Retry on reconnect.
- Show an explicit failure indicator.
- Avoid silently replacing newer server content.

### Multilingual transcripts

- Distinguish no captions from unsupported language.
- Allow fallback to another configured caption language.
- Only start speech-to-text when caption resolution is exhausted.
- Do not cache a failed or wrong-language transcript as a valid ready result.

---

## Testing Plan

### AI notes

- Generate one complete minute and verify persistence.
- Reload and verify notes return.
- Open two tabs and verify only one batch is inserted.
- Retry the same segment and verify idempotency.
- Simulate a partial database failure and verify no partial ready segment.
- End at a partial minute and verify final-segment handling.

### My Notes

- Type content and verify debounced persistence.
- Refresh and verify restoration.
- Simulate a network failure and verify local content remains.
- Open two tabs and verify conflict behavior.

### Revision cards

- Verify checkpoints at 10:00, 20:00, and 30:00.
- Verify preparation begins before each checkpoint.
- Verify playback pauses exactly at the boundary.
- Verify a ready card appears without an AI-generation wait.
- Simulate a slow model response and verify preparation UI.
- Reload during a checkpoint and verify restoration.
- Seek forward and verify skipped windows are not falsely completed.

### Hindi support

- Hindi manual captions → English notes.
- Hindi automatic captions → English notes.
- Hindi captions → English revision card.
- Hindi captions → English quiz with valid Hindi source grounding.
- Mixed Hindi/English technical content.
- Hindi speech containing English code/API terminology.
- Video with both Hindi and English tracks and deterministic selection.
- Previously cached English transcript followed by a Hindi request.
- Hindi video with no captions and speech-to-text fallback.

### Security and ownership

- User cannot access another user’s notes, artifacts, or attempts.
- Service-role database access remains server-only.
- Generation endpoints validate session ownership.
- User content is length-limited and validated.

---

## Recommended Delivery Order

### Priority 1 — Correctness

1. Fix Unicode quiz evidence validation.
2. Add explicit source-language and English-output instructions.
3. Configure Hindi caption priority with `hi,en`.
4. Preserve selected transcript language metadata.
5. Add database idempotency for note segments.
6. Make note-batch persistence atomic.

### Priority 2 — Ten-minute revision experience

1. Change revision windows from three to 10 minutes.
2. Add revision-card persistence.
3. Add server-owned generation statuses.
4. Pre-generate before the checkpoint.
5. Pause exactly at the checkpoint.
6. Persist quiz attempts.

### Priority 3 — Loading and optimistic UX

1. Split initial page loading states.
2. Add notes sidebar placeholders.
3. Add revision preparation status.
4. Replace the single note-loading boolean with per-job state.
5. Add optimistic-edit rollback and retry handling.

### Priority 4 — User notes

1. Add My Notes storage and API.
2. Add debounced autosave.
3. Add save status and failure recovery.
4. Add cross-tab conflict protection.

### Priority 5 — Audio-only videos

1. Select a Hindi-capable speech-to-text provider.
2. Add authorized audio acquisition.
3. Produce timed Hindi transcript segments.
4. Cache transcript variants with language metadata.
5. Feed the transcript into the existing English-generation pipeline.

---

## Definition of Done

Phase 2 is complete when:

- AI notes are saved exactly once for each watched segment.
- Partial or failed note batches cannot be mistaken for complete batches.
- My Notes survive refresh and session reopening.
- Revision cards occur every 10 minutes.
- Revision cards and quizzes are prepared before their checkpoint in normal conditions.
- Playback pauses at the intended checkpoint rather than after model latency.
- Revision cards and quiz attempts survive refresh.
- Sidebar and player loading are independent.
- Hindi caption tracks are selected deterministically.
- Source language is stored and passed through the generation pipeline.
- All learner-facing artifacts can be explicitly generated in English.
- Hindi evidence no longer fails ASCII-only quiz validation.
- Videos without captions have a documented and testable speech-to-text fallback, if included in the Phase 2 release scope.
