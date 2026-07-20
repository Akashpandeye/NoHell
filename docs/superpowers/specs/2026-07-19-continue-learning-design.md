# Continue Learning and Session Branding

## Goal

Make the session header use the shared NoHell logo and let signed-in users resume unfinished learning sessions across devices.

## Design

- Replace the session header's plain `NoHell` text link with the existing `AimMark` plus the NoHell wordmark.
- Add an authenticated `GET /api/sessions` route that returns the latest active or paused sessions for the current user, limited to three and ordered by start time.
- Add a `serverGetSessionsForUser` database helper that scopes the query by Clerk user ID and maps rows through the existing session mapper.
- Render a `Continue learning` section on the signed-in home page. Each card shows the video title, goal, saved watch position, and a `Resume` link to the existing session route. Hide the section when there are no unfinished sessions.
- Persist the current YouTube position through the existing session `PATCH` route on a short interval and when the page is hidden. When the player becomes ready, seek to the saved position.

## Behavior and errors

- Unauthenticated home requests do not render the section; the existing signed-out landing flow remains unchanged.
- A failed session-list request is silent and does not block starting a new session.
- Invalid session IDs remain handled by the existing route validation and ownership checks.
- Completed and abandoned sessions are excluded from the continue list.

## Verification

- Add a small assertion around the session-list normalization/filtering behavior if a test harness is available; otherwise use the existing TypeScript, lint, build, and local browser checks.
- Confirm the logo is visible at `/session/[sessionId]`, unfinished sessions appear on `/`, clicking `Resume` opens the right session, and the player seeks to the saved position.
