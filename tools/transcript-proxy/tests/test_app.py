from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sys
import types
import unittest
from unittest.mock import Mock, patch

PROXY_ROOT = os.path.dirname(os.path.dirname(__file__))
if PROXY_ROOT not in sys.path:
    sys.path.insert(0, PROXY_ROOT)

# Keep the unit suite runnable in environments where optional proxy dependencies
# have not been installed yet. Production installs the pinned requirements.
if importlib.util.find_spec("youtube_transcript_api") is None:
    package = types.ModuleType("youtube_transcript_api")
    errors = types.ModuleType("youtube_transcript_api._errors")
    proxies = types.ModuleType("youtube_transcript_api.proxies")

    class CouldNotRetrieveTranscript(Exception):
        pass

    class NoTranscriptFound(CouldNotRetrieveTranscript):
        pass

    class RequestBlocked(CouldNotRetrieveTranscript):
        pass

    class TranscriptsDisabled(CouldNotRetrieveTranscript):
        pass

    class VideoUnavailable(CouldNotRetrieveTranscript):
        pass

    class YouTubeTranscriptApi:
        def __init__(self, proxy_config=None):
            self.proxy_config = proxy_config

        def fetch(self, *args, **kwargs):
            raise NotImplementedError

    class GenericProxyConfig:
        def __init__(self, http_url=None, https_url=None):
            self.http_url = http_url
            self.https_url = https_url

    class WebshareProxyConfig:
        def __init__(
            self, proxy_username, proxy_password, filter_ip_locations=None
        ):
            self.proxy_username = proxy_username
            self.proxy_password = proxy_password
            self._filter_ip_locations = filter_ip_locations

    package.YouTubeTranscriptApi = YouTubeTranscriptApi
    for exception in (
        CouldNotRetrieveTranscript,
        NoTranscriptFound,
        RequestBlocked,
        TranscriptsDisabled,
        VideoUnavailable,
    ):
        setattr(errors, exception.__name__, exception)
    proxies.GenericProxyConfig = GenericProxyConfig
    proxies.WebshareProxyConfig = WebshareProxyConfig
    sys.modules["youtube_transcript_api"] = package
    sys.modules["youtube_transcript_api._errors"] = errors
    sys.modules["youtube_transcript_api.proxies"] = proxies

app_module = importlib.import_module("app")


class FakeSnippet:
    def __init__(self, text: str, start: float, duration: float) -> None:
        self.text = text
        self.start = start
        self.duration = duration


class TranscriptProxyTests(unittest.TestCase):
    def make_client(self, fetch_result=None, config=None):
        api = Mock()
        api.fetch.return_value = fetch_result or [FakeSnippet("hello", 1.25, 2.5)]
        settings = {
            "AUTH_TOKEN": "correct-secret",
            "LANGUAGES": ["en", "hi"],
            "CACHE_TTL_SECONDS": 60,
            "CACHE_MAX_ENTRIES": 10,
            "RETRY_AFTER_SECONDS": 17,
            "TESTING": True,
        }
        settings.update(config or {})
        flask_app = app_module.create_app(settings, transcript_api=api)
        return flask_app.test_client(), api

    def test_healthz_does_not_require_authentication(self):
        client, _ = self.make_client()
        response = client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"ok": True})

    def test_transcript_requires_safe_bearer_authentication(self):
        client, api = self.make_client()
        for header in (None, "correct-secret", "Basic correct-secret", "Bearer wrong-secret"):
            headers = {} if header is None else {"Authorization": header}
            response = client.get("/transcript?videoId=abcdefghijk", headers=headers)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.get_json()["error"]["code"], "unauthorized")
        api.fetch.assert_not_called()

    def test_transcript_returns_expected_lines_and_uses_configured_languages(self):
        client, api = self.make_client()
        response = client.get(
            "/transcript?videoId=abcdefghijk",
            headers={"Authorization": "Bearer correct-secret"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "ok": True,
                "videoId": "abcdefghijk",
                "lines": [{"text": "hello", "start": 1.25, "duration": 2.5}],
            },
        )
        api.fetch.assert_called_once_with(
            "abcdefghijk", languages=["en", "hi"], preserve_formatting=False
        )

    def test_missing_or_invalid_video_id_returns_typed_non_sensitive_error(self):
        client, api = self.make_client()
        auth = {"Authorization": "Bearer correct-secret"}
        for path in ("/transcript", "/transcript?videoId=bad%20id"):
            response = client.get(path, headers=auth)
            self.assertEqual(response.status_code, 400)
            payload = response.get_json()
            self.assertEqual(payload["error"], {"code": "invalid_video_id"})
            self.assertNotIn("bad id", response.get_data(as_text=True))
        api.fetch.assert_not_called()

    def test_successful_responses_are_cached(self):
        client, api = self.make_client()
        auth = {"Authorization": "Bearer correct-secret"}
        first = client.get("/transcript?videoId=abcdefghijk", headers=auth)
        second = client.get("/transcript?videoId=abcdefghijk", headers=auth)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(api.fetch.call_count, 1)

    def test_unavailable_transcript_has_typed_error(self):
        class Unavailable(Exception):
            pass

        client, api = self.make_client()
        api.fetch.side_effect = Unavailable("private upstream detail")
        auth = {"Authorization": "Bearer correct-secret"}
        with patch.object(app_module, "TRANSCRIPT_UNAVAILABLE_ERRORS", (Unavailable,)):
            response = client.get("/transcript?videoId=abcdefghijk", headers=auth)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()["error"], {"code": "transcript_unavailable"})
        self.assertNotIn("private upstream detail", response.get_data(as_text=True))

    def test_rate_limit_returns_retry_after_without_leaking_details(self):
        class RateLimited(Exception):
            pass

        client, api = self.make_client()
        api.fetch.side_effect = RateLimited("proxy password was secret")
        auth = {"Authorization": "Bearer correct-secret"}
        with patch.object(app_module, "RATE_LIMIT_ERRORS", (RateLimited,)):
            response = client.get("/transcript?videoId=abcdefghijk", headers=auth)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["Retry-After"], "17")
        self.assertEqual(response.get_json()["error"], {"code": "upstream_rate_limited"})
        self.assertNotIn("proxy password", response.get_data(as_text=True))

    def test_unknown_upstream_error_is_safe_and_retryable(self):
        client, api = self.make_client()
        api.fetch.side_effect = RuntimeError("sensitive upstream response")
        auth = {"Authorization": "Bearer correct-secret"}
        response = client.get("/transcript?videoId=abcdefghijk", headers=auth)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.headers["Retry-After"], "17")
        self.assertEqual(response.get_json()["error"], {"code": "upstream_unavailable"})
        self.assertNotIn("sensitive upstream response", response.get_data(as_text=True))

    def test_logs_are_structured_and_do_not_include_credentials(self):
        client, _ = self.make_client()
        with patch.object(app_module.LOGGER, "info") as log_info:
            response = client.get(
                "/transcript?videoId=abcdefghijk",
                headers={"Authorization": "Bearer correct-secret"},
            )
        self.assertEqual(response.status_code, 200)
        record = json.loads(log_info.call_args.args[0])
        self.assertEqual(record["event"], "request_complete")
        self.assertEqual(record["status"], 200)
        serialized = json.dumps(record)
        self.assertNotIn("correct-secret", serialized)
        self.assertNotIn("abcdefghijk", serialized)


class CacheTests(unittest.TestCase):
    def test_cache_expires_and_evicts_oldest_entry(self):
        clock = Mock(return_value=0.0)
        cache = app_module.TTLCache(max_entries=2, ttl_seconds=10, clock=clock)
        cache.set("a", 1)
        clock.return_value = 1.0
        cache.set("b", 2)
        clock.return_value = 2.0
        cache.set("c", 3)
        self.assertIsNone(cache.get("a"))
        self.assertEqual(cache.get("b"), 2)
        clock.return_value = 12.0
        self.assertIsNone(cache.get("b"))
        self.assertIsNone(cache.get("c"))


class ConfigurationTests(unittest.TestCase):
    def test_webshare_proxy_takes_precedence(self):
        env = {
            "WEBSHARE_PROXY_USERNAME": "user",
            "WEBSHARE_PROXY_PASSWORD": "pass",
            "WEBSHARE_FILTER_IP_LOCATIONS": "us, gb",
            "YT_HTTP_PROXY_URL": "http://generic.invalid",
        }
        proxy = app_module.build_proxy_config(env)
        self.assertIsInstance(proxy, app_module.WebshareProxyConfig)
        self.assertEqual(proxy.proxy_username, "user")
        self.assertEqual(proxy.proxy_password, "pass")
        self.assertEqual(proxy._filter_ip_locations, ["us", "gb"])

    def test_generic_proxy_supports_http_and_https(self):
        proxy = app_module.build_proxy_config(
            {
                "YT_HTTP_PROXY_URL": "http://proxy.example:8080",
                "YT_HTTPS_PROXY_URL": "https://proxy.example:8443",
            }
        )
        self.assertIsInstance(proxy, app_module.GenericProxyConfig)
        self.assertEqual(proxy.http_url, "http://proxy.example:8080")
        self.assertEqual(proxy.https_url, "https://proxy.example:8443")

    def test_languages_are_configurable_with_safe_default(self):
        self.assertEqual(app_module.parse_languages({}), ["en"])
        self.assertEqual(
            app_module.parse_languages({"YT_TRANSCRIPT_LANGUAGES": "en, hi,es"}),
            ["en", "hi", "es"],
        )


if __name__ == "__main__":
    unittest.main()
