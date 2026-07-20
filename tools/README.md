# Tools (optional integrations)

## Production YouTube transcript proxy

The deployment-ready proxy lives in `tools/transcript-proxy/`. It runs Flask behind Gunicorn and is intended to be deployed separately from the Next.js application because YouTube commonly blocks cloud data-center IPs.

Endpoints:

- `GET /healthz` returns `{"ok": true}` and does not require authentication.
- `GET /transcript?videoId=VIDEO_ID` returns transcript lines in the shape expected by the app.

`/transcript` accepts `Authorization: Bearer <token>` when `YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN` is configured. Production deployments must set a strong token. Authentication uses constant-time token comparison, and errors/logs never include tokens, proxy credentials, upstream exception messages, or video IDs.

### Run locally with Python

From `tools/transcript-proxy/`:

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
set YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN=replace-with-a-long-random-secret
python app.py
```

On macOS/Linux, use `export` instead of `set`. The development server listens on `0.0.0.0:${PORT:-8787}`. Use Gunicorn or the Docker image in production.

### Run with Docker

```bash
docker build -t nohell-transcript-proxy tools/transcript-proxy
docker run --rm -p 8787:8787 \
  -e YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN=replace-with-a-long-random-secret \
  nohell-transcript-proxy
```

The image runs as a non-root user and includes an HTTP health check. Gunicorn honors `PORT`; workers, threads, and timeout can be tuned with `GUNICORN_WORKERS`, `GUNICORN_THREADS`, and `GUNICORN_TIMEOUT`.

### Deploy on Render

The repository root contains `render.yaml`. Create a Render Blueprint from the repository, then provide these secret values when prompted:

- `YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN`: a long random secret shared with the Next.js server.
- `WEBSHARE_PROXY_USERNAME` and `WEBSHARE_PROXY_PASSWORD`: recommended for production reliability.
- `WEBSHARE_FILTER_IP_LOCATIONS`: optional comma-separated country codes such as `us,gb`.

Render supplies `PORT` automatically and checks `/healthz`. After deployment, configure the Next.js environment:

```bash
YOUTUBE_TRANSCRIPT_PROVIDER_URL=https://YOUR-RENDER-SERVICE.onrender.com/transcript
YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN=the-same-shared-secret
```

### Proxy configuration

Webshare takes precedence when both Webshare credentials are present:

```bash
WEBSHARE_PROXY_USERNAME=
WEBSHARE_PROXY_PASSWORD=
WEBSHARE_FILTER_IP_LOCATIONS=us,gb
```

A generic HTTP/HTTPS proxy is also supported:

```bash
YT_HTTP_PROXY_URL=http://user:password@proxy.example:8080
YT_HTTPS_PROXY_URL=http://user:password@proxy.example:8080
```

Other service settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listening port; supplied automatically by Render. |
| `YT_TRANSCRIPT_LANGUAGES` | `en` | Comma-separated preferred languages in priority order. |
| `YT_TRANSCRIPT_PRESERVE_FORMATTING` | `false` | Preserve caption HTML formatting supported by the upstream library. |
| `YT_TRANSCRIPT_CACHE_TTL_SECONDS` | `300` | In-memory success-cache TTL, bounded to 1–86400 seconds. |
| `YT_TRANSCRIPT_CACHE_MAX_ENTRIES` | `256` | Maximum in-memory entries, bounded to 1–10000. |
| `YT_TRANSCRIPT_RETRY_AFTER_SECONDS` | `30` | `Retry-After` value for retryable upstream failures. |

The cache is local to each Gunicorn process and intentionally bounded. It reduces repeat requests but is not a shared or durable cache.

### API errors

Errors are JSON and expose only stable, non-sensitive codes:

- `invalid_video_id` (`400`)
- `unauthorized` (`401`)
- `transcript_unavailable` (`404`)
- `not_found` (`404`)
- `method_not_allowed` (`405`)
- `upstream_unavailable` (`502`, with `Retry-After`)
- `upstream_rate_limited` (`503`, with `Retry-After`)

Example:

```json
{"ok": false, "error": {"code": "upstream_rate_limited"}}
```

Request logs are one-line structured JSON with request ID, path, status, duration, cache status, and typed error code. Upstream exception messages are not logged.

### Tests

From the repository root:

```bash
python -m unittest discover -s tools/transcript-proxy/tests -v
```

The suite uses `unittest` and mocks network access.

## Legacy compatibility script

`tools/youtube_transcript_proxy.py` is preserved for existing local workflows. It is superseded for production by `tools/transcript-proxy/` and may be deprecated in a future release. Existing commands continue to work, but new deployments should use the Flask/Gunicorn service and `render.yaml`.
