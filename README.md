# NoHell

NoHell is a learning companion for long YouTube coding tutorials. It turns passive watching into guided study with transcript-aware checkpoints, categorized AI notes, three-minute revision cards, optional quizzes, bookmarks, summaries, and end-of-session recall prompts.

## Stack

- Next.js 15 App Router and React 19
- Clerk authentication
- Supabase/PostgreSQL persistence
- OpenRouter for AI generation
- Razorpay payments
- Tailwind CSS 4
- External Python transcript proxy for production caption reliability

## Main learning flow

1. Paste a YouTube tutorial URL and define a learning goal.
2. Start or resume an authenticated learning session.
3. Reuse a cached transcript when available; otherwise extract it through the configured provider.
4. Generate transcript-aware checkpoints, with deterministic fallback checkpoints when captions or AI are unavailable.
5. Generate categorized Theory, Important, Syntax, and Logic notes during natural playback.
6. Pause after completed three-minute windows for a comprehensive revision card and, only when the transcript supports it, an optional multiple-choice quiz.
7. Preserve playback position, notes, bookmarks, and end-of-session recall questions.

Video playback remains available when captions cannot be loaded. Transcript-dependent notes, summaries, and revision cards stay disabled until captions become available.

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env.local` and provide at least:

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_MODEL=tencent/hy3:free

# Razorpay, when payments are enabled
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
RAZORPAY_WEBHOOK_SECRET=
```

The Supabase service-role key and all AI/payment secrets are server-only and must never use a `NEXT_PUBLIC_` prefix.

### 3. Bootstrap Supabase

For a fresh project, run [`supabase-schema.sql`](./supabase-schema.sql) in the Supabase SQL Editor.

For an existing project, apply the checked-in migrations in order, including:

- [`supabase/migrations/202607190001_production_security.sql`](./supabase/migrations/202607190001_production_security.sql)
- [`supabase/migrations/202607200001_video_transcript_cache.sql`](./supabase/migrations/202607200001_video_transcript_cache.sql)

The transcript cache is service-role-only. Browser `anon` and `authenticated` roles cannot read or write cached caption data directly.

### 4. Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Production captions on Vercel

YouTube commonly blocks unofficial caption requests from cloud and datacenter IP ranges, including Vercel egress. A different Node package cannot reliably fix an IP-level block.

For production, deploy the service in [`tools/transcript-proxy`](./tools/transcript-proxy) outside Vercel, ideally with a supported rotating proxy, then configure Vercel:

```bash
YOUTUBE_TRANSCRIPT_PROVIDER_URL=https://your-transcript-service.example.com/transcript
YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN=the-same-strong-secret-used-by-the-proxy
YOUTUBE_TRANSCRIPT_ALLOW_DIRECT_FALLBACK=false
```

With direct fallback disabled, a failed external provider returns promptly instead of waiting on another request from a likely blocked Vercel IP.

The Next.js app stores successful normalized transcripts in Supabase by YouTube video ID. Refreshing, resuming, or opening another session for the same video reuses the cached transcript rather than contacting YouTube again. Atomic database leases prevent concurrent Vercel functions from extracting the same video simultaneously.

### Deploy the proxy on Render

The root [`render.yaml`](./render.yaml) and proxy Dockerfile provide a Render Blueprint deployment:

1. Create a Render Blueprint from this repository.
2. Set `YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN` to a strong random secret.
3. Configure Webshare or generic proxy credentials if required.
4. Verify `GET /healthz`.
5. Verify an authenticated `GET /transcript?videoId=VIDEO_ID` request.
6. Copy the service URL and shared token into Vercel Production environment variables.
7. Redeploy the Next.js app after changing environment variables.

See [`tools/README.md`](./tools/README.md) for local, Docker, Render, language, cache, and proxy configuration.

## Transcript status behavior

The authenticated route `/api/sessions/[sessionId]/transcript` returns typed outcomes:

- `ready`: normalized transcript is available, usually from Supabase cache.
- `fetching`: another request currently owns the extraction lease.
- `unavailable`: no usable captions exist for the video.
- `failed`: provider, network, configuration, or cache failure; retryability is included.

The session screen shows the actual status used by timed learning features and offers **Retry captions** for retryable failures. It does not rely on a temporary browser-storage flag.

## Scripts

```bash
npm run dev
npm run dev:clean
npm run build
npm run start
npm run lint
npm run test:contracts
npm run test:proxy
npx tsc --noEmit
```

Do not run `next build` while `next dev` is actively writing the same `.next` directory. Stop the development server first or use an isolated build directory/worktree.

## Important routes

- `/` — landing and session start
- `/onboarding` — learning profile
- `/pricing` — plan upgrade
- `/session/[sessionId]` — active learning session
- `/session/[sessionId]/recap` — completed-session recap
- `/api/session/start` — idempotent session admission and checkpoint generation
- `/api/notes/generate` — categorized timed notes
- `/api/revision/card` — comprehensive revision card and optional grounded quiz
- `/api/sessions/[sessionId]/transcript` — owned cached transcript and manual retry
- `/api/session/summary` — watched-content summary
- `/api/session/end` — session completion and recall generation

## Verification before production

```bash
npm run test:contracts
npm run test:proxy
npm run lint
npx tsc --noEmit
npm run build
```

Also verify against deployed infrastructure:

1. Apply the Supabase transcript-cache migration.
2. Confirm the proxy health endpoint and authenticated transcript endpoint.
3. Start a session using a known captioned video.
4. Refresh/resume and confirm the transcript loads from cache.
5. Start another session for the same video and confirm no new extraction is required.
6. Test a video with unavailable captions and a simulated provider timeout.
7. Confirm client errors and logs contain no API keys, bearer tokens, proxy credentials, or transcript text.
