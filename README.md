# NoHell

NoHell is a learning companion for long YouTube coding tutorials. It turns passive watching into guided study with AI-generated checkpoints, in-session notes, revision cards, and recap prompts.

The current app is built with Next.js, React 19, Clerk, Supabase, Groq, and Razorpay.

## What It Does

- Paste a YouTube tutorial URL and define a learning goal.
- Generate 3 to 5 checkpoints based on the transcript or, if captions are unavailable, from the tutorial title and goal.
- Save sessions, notes, usage, and onboarding data in Supabase.
- Personalize checkpoint generation with onboarding answers like level, tech focus, and note style.
- Enforce a free-tier limit of 5 sessions and unlock unlimited sessions with the Pro plan.
- Upgrade users through Razorpay payment verification or webhook handling.

## Stack

- `next@15`
- `react@19`
- `@clerk/nextjs` for authentication
- `@supabase/supabase-js` for persistence
- `groq-sdk` for AI generation
- `razorpay` for payments
- `tailwindcss@4`

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create environment variables

Create `.env.local` in the project root and add:

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Groq
GROQ_API_KEY=

# Razorpay
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=
RAZORPAY_WEBHOOK_SECRET=

# Optional external transcript provider
YOUTUBE_TRANSCRIPT_PROVIDER_URL=
YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN=

# Optional Razorpay overrides
RAZORPAY_ORDER_CURRENCY=USD
RAZORPAY_ORDER_AMOUNT_MINOR=900
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is the recommended server-side configuration. Without it, some server helpers fall back to the public client.
- `GROQ_API_KEY` is optional. If it is missing, NoHell falls back to a simpler checkpoint generator.
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` is optional and falls back to `RAZORPAY_KEY_ID`.
- `YOUTUBE_TRANSCRIPT_PROVIDER_URL` is optional. If set, NoHell will try that provider before the built-in Node transcript fetcher.
- `YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN` is optional bearer auth for that provider.
- The default Pro price is `$9/month`.

### 3. Bootstrap Supabase

Run the SQL in [`supabase-schema.sql`](/home/raakash/Desktop/project/NoHell/supabase-schema.sql) in the Supabase SQL Editor.

That creates:

- `users`
- `sessions`
- `notes`
- `bookmarks`

The schema currently enables permissive RLS policies for development. Tighten those before production.

### 4. Start the app

```bash
npm run dev
```

Open `http://localhost:3000`.

## Production Transcript Fallback

If transcript loading works locally but fails after deployment, that is usually an IP reputation problem, not just a library problem. This repo includes [`tools/youtube_transcript_proxy.py`](/home/raakash/Desktop/project/NoHell/tools/youtube_transcript_proxy.py), a small Python HTTP bridge around `youtube-transcript-api`.

Install it on a separate machine or service:

```bash
pip install youtube-transcript-api
python tools/youtube_transcript_proxy.py
```

Then point the Next.js app at it:

```bash
YOUTUBE_TRANSCRIPT_PROVIDER_URL=https://your-transcript-host/transcript
YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN=your-shared-secret
```

Optional proxy settings for the Python service:

```bash
WEBSHARE_PROXY_USERNAME=
WEBSHARE_PROXY_PASSWORD=
WEBSHARE_FILTER_IP_LOCATIONS=us,in

# or generic proxies
YT_HTTP_PROXY_URL=
YT_HTTPS_PROXY_URL=
```

Optional transcript service settings:

```bash
YT_TRANSCRIPT_LANGUAGES=en
YT_TRANSCRIPT_PRESERVE_FORMATTING=false
YOUTUBE_TRANSCRIPT_PROXY_PORT=8787
```

## Scripts

```bash
npm run dev
npm run dev:clean
npm run build
npm run start
npm run lint
```

## Product Flow

1. A user lands on the homepage and pastes a YouTube URL.
2. Signed-out users are redirected into Clerk auth.
3. Signed-in users enter a learning goal and start a session.
4. The server fetches transcript data, generates checkpoints, creates a session, and increments usage.
5. New users complete onboarding before hitting pricing.
6. Free users can start up to 5 sessions. Pro users have no session cap.

## Important Routes

- `/` landing page and session start flow
- `/onboarding` learning profile capture
- `/pricing` upgrade screen
- `/session/[sessionId]` active learning session
- `/session/[sessionId]/recap` post-session recap

## API Surface

- `/api/session/start` creates a session and generates checkpoints
- `/api/session/end` finishes a session and can generate recap content
- `/api/notes/generate` creates AI notes during a session
- `/api/revision/card` generates revision cards
- `/api/user/onboarding` reads and saves onboarding answers
- `/api/user/usage` returns free/pro usage state
- `/api/payment/create-order` creates a Razorpay order
- `/api/payment/verify` verifies a Razorpay payment client-side
- `/api/payment/webhook` handles Razorpay webhooks server-side

## Current Limits And Assumptions

- Transcript fetching depends on public YouTube captions and may be unavailable for some videos or hosting environments.
- Middleware is currently configured with an empty protected-route matcher, so route protection is opt-in.
- Supabase policies are development-friendly and should be hardened for production.

## Repo Structure

```text
src/app/                  App Router pages and API routes
src/components/           UI components
src/lib/                  transcript, pricing, Supabase, and billing helpers
src/types/                shared types
public/                   static assets
supabase-schema.sql       database bootstrap
```
