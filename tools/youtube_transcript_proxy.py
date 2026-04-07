#!/usr/bin/env python3
"""
Minimal HTTP wrapper around `youtube-transcript-api`.

Run this outside Vercel if YouTube blocks your app host's IP. For better
reliability on cloud hosts, configure a rotating proxy supported by
`youtube-transcript-api`.
"""

from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig


def env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def parse_languages() -> list[str]:
    raw = env("YT_TRANSCRIPT_LANGUAGES")
    if not raw:
        return ["en"]
    return [part.strip() for part in raw.split(",") if part.strip()]


def parse_bool(name: str, default: bool = False) -> bool:
    value = env(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def build_api() -> YouTubeTranscriptApi:
    webshare_user = env("WEBSHARE_PROXY_USERNAME")
    webshare_pass = env("WEBSHARE_PROXY_PASSWORD")
    if webshare_user and webshare_pass:
        locations_raw = env("WEBSHARE_FILTER_IP_LOCATIONS")
        locations = (
            [item.strip() for item in locations_raw.split(",") if item.strip()]
            if locations_raw
            else None
        )
        return YouTubeTranscriptApi(
            proxy_config=WebshareProxyConfig(
                proxy_username=webshare_user,
                proxy_password=webshare_pass,
                filter_ip_locations=locations,
            )
        )

    http_url = env("YT_HTTP_PROXY_URL")
    https_url = env("YT_HTTPS_PROXY_URL")
    if http_url or https_url:
        return YouTubeTranscriptApi(
            proxy_config=GenericProxyConfig(
                http_url=http_url,
                https_url=https_url,
            )
        )

    return YouTubeTranscriptApi()


API = build_api()
AUTH_TOKEN = env("YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN")
LANGUAGES = parse_languages()
PRESERVE_FORMATTING = parse_bool("YT_TRANSCRIPT_PRESERVE_FORMATTING", False)


class Handler(BaseHTTPRequestHandler):
    server_version = "NoHellTranscriptProxy/1.0"

    def _write_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        if not AUTH_TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        return header == f"Bearer {AUTH_TOKEN}"

    def log_message(self, fmt: str, *args) -> None:
        return

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self._write_json(HTTPStatus.OK, {"ok": True})
            return

        if parsed.path != "/transcript":
            self._write_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        if not self._authorized():
            self._write_json(HTTPStatus.UNAUTHORIZED, {"error": "Unauthorized"})
            return

        params = parse_qs(parsed.query)
        video_id = (params.get("videoId") or [""])[0].strip()
        if not video_id:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                {"error": "Missing videoId query parameter"},
            )
            return

        try:
            transcript = API.fetch(
                video_id,
                languages=LANGUAGES,
                preserve_formatting=PRESERVE_FORMATTING,
            )
            lines = [
                {
                    "text": item.text,
                    "start": item.start,
                    "duration": item.duration,
                }
                for item in transcript
            ]
            if not lines:
                self._write_json(
                    HTTPStatus.NOT_FOUND,
                    {"error": "Transcript unavailable"},
                )
                return

            self._write_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "lines": lines,
                    "videoId": video_id,
                },
            )
        except Exception as exc:
            self._write_json(
                HTTPStatus.BAD_GATEWAY,
                {"ok": False, "error": type(exc).__name__, "message": str(exc)},
            )


def main() -> None:
    host = env("YOUTUBE_TRANSCRIPT_PROXY_HOST") or "0.0.0.0"
    port = int(env("YOUTUBE_TRANSCRIPT_PROXY_PORT") or "8787")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"youtube transcript proxy listening on http://{host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
