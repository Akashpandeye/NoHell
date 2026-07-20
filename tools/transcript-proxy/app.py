from __future__ import annotations

import hmac
import json
import logging
import os
import re
import time
import uuid
from collections import OrderedDict
from threading import Lock
from typing import Any, Callable, Mapping

from flask import Flask, Response, g, jsonify, request
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    CouldNotRetrieveTranscript,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)
from youtube_transcript_api.proxies import GenericProxyConfig, WebshareProxyConfig

LOGGER = logging.getLogger("transcript_proxy")
if not LOGGER.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    LOGGER.addHandler(handler)
LOGGER.setLevel(logging.INFO)
LOGGER.propagate = False

VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{6,128}$")
TRANSCRIPT_UNAVAILABLE_ERRORS = (
    NoTranscriptFound,
    TranscriptsDisabled,
    VideoUnavailable,
)
RATE_LIMIT_ERRORS = (RequestBlocked,)


def _env_value(env: Mapping[str, str], name: str) -> str | None:
    value = env.get(name, "").strip()
    return value or None


def _parse_positive_int(
    env: Mapping[str, str], name: str, default: int, maximum: int
) -> int:
    raw = _env_value(env, name)
    if raw is None:
        return default
    try:
        return max(1, min(int(raw), maximum))
    except ValueError:
        return default


def parse_languages(env: Mapping[str, str]) -> list[str]:
    raw = _env_value(env, "YT_TRANSCRIPT_LANGUAGES")
    if raw is None:
        return ["en"]
    languages = [item.strip() for item in raw.split(",") if item.strip()]
    return languages or ["en"]


def parse_bool(env: Mapping[str, str], name: str, default: bool = False) -> bool:
    raw = _env_value(env, name)
    if raw is None:
        return default
    return raw.lower() in {"1", "true", "yes", "on"}


def build_proxy_config(env: Mapping[str, str]) -> Any | None:
    webshare_username = _env_value(env, "WEBSHARE_PROXY_USERNAME")
    webshare_password = _env_value(env, "WEBSHARE_PROXY_PASSWORD")
    if webshare_username and webshare_password:
        raw_locations = _env_value(env, "WEBSHARE_FILTER_IP_LOCATIONS")
        locations = None
        if raw_locations:
            locations = [item.strip() for item in raw_locations.split(",") if item.strip()]
        return WebshareProxyConfig(
            proxy_username=webshare_username,
            proxy_password=webshare_password,
            filter_ip_locations=locations,
        )

    http_url = _env_value(env, "YT_HTTP_PROXY_URL")
    https_url = _env_value(env, "YT_HTTPS_PROXY_URL")
    if http_url or https_url:
        return GenericProxyConfig(http_url=http_url, https_url=https_url)
    return None


def build_transcript_api(env: Mapping[str, str]) -> YouTubeTranscriptApi:
    proxy_config = build_proxy_config(env)
    if proxy_config is None:
        return YouTubeTranscriptApi()
    return YouTubeTranscriptApi(proxy_config=proxy_config)


class TTLCache:
    def __init__(
        self,
        max_entries: int,
        ttl_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max_entries = max(1, max_entries)
        self._ttl_seconds = max(1, ttl_seconds)
        self._clock = clock
        self._entries: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._lock = Lock()

    def get(self, key: str) -> Any | None:
        now = self._clock()
        with self._lock:
            item = self._entries.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= now:
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return value

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._entries[key] = (self._clock() + self._ttl_seconds, value)
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)


def _error(code: str, status: int, retry_after: int | None = None) -> Response:
    g.error_code = code
    response = jsonify({"ok": False, "error": {"code": code}})
    response.status_code = status
    if retry_after is not None:
        response.headers["Retry-After"] = str(retry_after)
    return response


def create_app(
    config: Mapping[str, Any] | None = None,
    transcript_api: YouTubeTranscriptApi | None = None,
    env: Mapping[str, str] | None = None,
) -> Flask:
    environment = os.environ if env is None else env
    application = Flask(__name__)
    application.config.from_mapping(
        AUTH_TOKEN=_env_value(environment, "YOUTUBE_TRANSCRIPT_PROVIDER_TOKEN"),
        LANGUAGES=parse_languages(environment),
        PRESERVE_FORMATTING=parse_bool(
            environment, "YT_TRANSCRIPT_PRESERVE_FORMATTING", False
        ),
        CACHE_TTL_SECONDS=_parse_positive_int(
            environment, "YT_TRANSCRIPT_CACHE_TTL_SECONDS", 300, 86400
        ),
        CACHE_MAX_ENTRIES=_parse_positive_int(
            environment, "YT_TRANSCRIPT_CACHE_MAX_ENTRIES", 256, 10000
        ),
        RETRY_AFTER_SECONDS=_parse_positive_int(
            environment, "YT_TRANSCRIPT_RETRY_AFTER_SECONDS", 30, 3600
        ),
    )
    if config:
        application.config.update(config)

    api = transcript_api or build_transcript_api(environment)
    cache = TTLCache(
        max_entries=int(application.config["CACHE_MAX_ENTRIES"]),
        ttl_seconds=int(application.config["CACHE_TTL_SECONDS"]),
    )

    @application.before_request
    def begin_request() -> None:
        g.started_at = time.monotonic()
        g.request_id = uuid.uuid4().hex
        g.error_code = None
        g.cache_hit = False

    @application.after_request
    def finish_request(response: Response) -> Response:
        response.headers["X-Request-ID"] = g.request_id
        duration_ms = round((time.monotonic() - g.started_at) * 1000, 2)
        record = {
            "event": "request_complete",
            "request_id": g.request_id,
            "method": request.method,
            "path": request.path,
            "status": response.status_code,
            "duration_ms": duration_ms,
            "cache_hit": bool(g.cache_hit),
        }
        if g.error_code:
            record["error_code"] = g.error_code
        LOGGER.info(json.dumps(record, separators=(",", ":"), sort_keys=True))
        return response

    @application.get("/healthz")
    def healthz() -> Response:
        return jsonify({"ok": True})

    @application.get("/transcript")
    def transcript() -> Response:
        configured_token = application.config.get("AUTH_TOKEN")
        if configured_token:
            authorization = request.headers.get("Authorization", "")
            scheme, separator, supplied_token = authorization.partition(" ")
            if (
                separator != " "
                or scheme.lower() != "bearer"
                or not supplied_token
                or not hmac.compare_digest(str(configured_token), supplied_token)
            ):
                return _error("unauthorized", 401)

        video_id = request.args.get("videoId", "").strip()
        if not VIDEO_ID_PATTERN.fullmatch(video_id):
            return _error("invalid_video_id", 400)

        cache_key = "|".join(
            (
                video_id,
                ",".join(application.config["LANGUAGES"]),
                str(bool(application.config["PRESERVE_FORMATTING"])),
            )
        )
        cached = cache.get(cache_key)
        if cached is not None:
            g.cache_hit = True
            return jsonify(cached)

        try:
            fetched = api.fetch(
                video_id,
                languages=application.config["LANGUAGES"],
                preserve_formatting=bool(application.config["PRESERVE_FORMATTING"]),
            )
            lines = [
                {
                    "text": item.text,
                    "start": item.start,
                    "duration": item.duration,
                }
                for item in fetched
            ]
            if not lines:
                return _error("transcript_unavailable", 404)
            payload = {"ok": True, "videoId": video_id, "lines": lines}
            cache.set(cache_key, payload)
            return jsonify(payload)
        except TRANSCRIPT_UNAVAILABLE_ERRORS:
            return _error("transcript_unavailable", 404)
        except RATE_LIMIT_ERRORS as exc:
            LOGGER.warning(
                json.dumps(
                    {
                        "event": "upstream_error",
                        "request_id": g.request_id,
                        "error_type": type(exc).__name__,
                        "error_code": "upstream_rate_limited",
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            return _error(
                "upstream_rate_limited",
                503,
                int(application.config["RETRY_AFTER_SECONDS"]),
            )
        except CouldNotRetrieveTranscript as exc:
            LOGGER.warning(
                json.dumps(
                    {
                        "event": "upstream_error",
                        "request_id": g.request_id,
                        "error_type": type(exc).__name__,
                        "error_code": "upstream_unavailable",
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            return _error(
                "upstream_unavailable",
                502,
                int(application.config["RETRY_AFTER_SECONDS"]),
            )
        except Exception as exc:
            LOGGER.error(
                json.dumps(
                    {
                        "event": "upstream_error",
                        "request_id": g.request_id,
                        "error_type": type(exc).__name__,
                        "error_code": "upstream_unavailable",
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                )
            )
            return _error(
                "upstream_unavailable",
                502,
                int(application.config["RETRY_AFTER_SECONDS"]),
            )

    @application.errorhandler(404)
    def not_found(_: Exception) -> Response:
        return _error("not_found", 404)

    @application.errorhandler(405)
    def method_not_allowed(_: Exception) -> Response:
        return _error("method_not_allowed", 405)

    return application


app = create_app()


if __name__ == "__main__":
    port = _parse_positive_int(os.environ, "PORT", 8787, 65535)
    app.run(host="0.0.0.0", port=port)
