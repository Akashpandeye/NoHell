# Tools (optional integrations)

## YouTube transcript proxy (`youtube_transcript_proxy.py`)

Vercel and many cloud hosts get **blocked by YouTube** when fetching captions. This script runs **outside** that network (home PC, cheap VPS, Railway, Fly.io, etc.) and exposes a small HTTP API your Next.js app can call.

### 1. Install Python dependencies

```bash
pip install youtube-transcript-api
```

### 2. Run the server

From the repo root:

```bash
python tools/youtube_transcript_proxy.py
```

Default: `http://0.0.0.0:8787` — endpoints:

- `GET /healthz` — health check
- `GET /transcript?videoId=VIDEO_ID` — JSON lines (same shape the Node app expects)

Optional env vars (see script header): `YOUTUBE_TRANSCRIPT_PROXY_PORT`, `YOUTUBE_TRANSCRIPT_PROXY_HOST`, `WEBSHARE_*` / `YT_*_PROXY_*` for residential proxies.

### 3. Point the Next.js app at it

In **`.env`** (local) or **Vercel → Environment Variables** (production):

```bash
# Full URL to the transcript path (must end with /transcript)
YOUTUBE_TRANSCRIPT_PROVIDER_URL=http://127.0.0.1:8787/transcript

# Optional: if you set YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN in Python
YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN=your-shared-secret
```

If you use a token, start Python with the same secret:

```bash
export YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN=your-shared-secret
python tools/youtube_transcript_proxy.py
```

### 4. How it connects in code

`src/lib/fetch-youtube-transcript.ts` tries **this URL first**, then falls back to the npm `youtube-transcript` package. No other code changes are required.

### 5. Production deployment of the proxy

- Expose the proxy over **HTTPS** (Caddy, nginx, Cloudflare Tunnel, etc.).
- Restrict access: use **`YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN`** and firewall to Vercel egress IPs if possible.
- Set `YOUTUBE_TRANSCRIPT_PROVIDER_URL=https://your-domain.com/transcript` on Vercel.

The **`tools/`** folder is not part of the Next.js build; deploy the Python process separately.
