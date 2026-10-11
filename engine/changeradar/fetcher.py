"""Polite HTTP fetching: robots.txt, conditional requests, retries, per-host rate limits.

The fetcher never tries to get around access controls. A 401/403, a login wall or a
CAPTCHA page is reported as such and the source is flagged for human review.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx

log = logging.getLogger(__name__)

DEFAULT_UA = "ChangeRadar/0.2 (+https://github.com/; personal change monitor; respects robots.txt)"
MAX_BYTES = 5 * 1024 * 1024
RETRY_STATUSES = {429, 500, 502, 503, 504}

CHALLENGE_MARKERS = (
    "cf-challenge", "captcha", "verify you are human", "人机验证", "请输入验证码", "安全验证",
    "access denied", "enable javascript and cookies to continue",
)


class FetchError(Exception):
    """Network/HTTP failure. ``blocked`` means access is restricted (not retried, not bypassed)."""

    def __init__(self, message: str, *, status: int | None = None, blocked: bool = False):
        super().__init__(message)
        self.status = status
        self.blocked = blocked


@dataclass
class FetchResult:
    url: str
    status: int
    text: str = ""
    etag: str | None = None
    last_modified: str | None = None
    not_modified: bool = False
    content_type: str = ""


@dataclass
class Fetcher:
    timeout: float = 20.0
    retries: int = 3
    backoff: float = 2.0
    min_host_interval: float = 2.0
    user_agent: str = field(default_factory=lambda: os.environ.get("CHANGERADAR_USER_AGENT", DEFAULT_UA))
    client: httpx.Client | None = None
    sleep: callable = time.sleep  # injectable for tests
    _robots: dict[str, RobotFileParser | None] = field(default_factory=dict)
    _robots_note: dict[str, str] = field(default_factory=dict)
    _last_hit: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.client is None:
            self.client = httpx.Client(
                timeout=self.timeout,
                follow_redirects=True,
                headers={"User-Agent": self.user_agent, "Accept-Encoding": "gzip, deflate"},
            )

    def close(self) -> None:
        if self.client is not None:
            self.client.close()

    # ------------------------------------------------------------------ robots.txt

    def allowed_by_robots(self, url: str) -> bool:
        """RFC 9309 semantics: 4xx → no rules (allowed); 5xx/unreachable → disallow all."""
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            parser: RobotFileParser | None = RobotFileParser()
            try:
                self._throttle(parts.netloc)
                resp = self.client.get(f"{origin}/robots.txt")
                if 400 <= resp.status_code < 500:
                    parser = None
                elif resp.status_code >= 500:
                    parser.parse(["User-agent: *", "Disallow: /"])
                    self._robots_note[origin] = f"robots.txt 返回 HTTP {resp.status_code}，按 RFC 9309 暂停访问该站点"
                else:
                    parser.parse(resp.text.splitlines())
            except httpx.HTTPError as exc:
                log.warning("robots.txt unreachable for %s: %s", origin, exc)
                parser.parse(["User-agent: *", "Disallow: /"])
                self._robots_note[origin] = f"无法获取 robots.txt（{type(exc).__name__}: {exc}），按 RFC 9309 暂停访问该站点"
            self._robots[origin] = parser
        parser = self._robots[origin]
        return True if parser is None else parser.can_fetch(self.user_agent, url)

    # ------------------------------------------------------------------ fetching

    def _throttle(self, host: str) -> None:
        last = self._last_hit.get(host)
        if last is not None:
            wait = self.min_host_interval - (time.monotonic() - last)
            if wait > 0:
                self.sleep(wait)
        self._last_hit[host] = time.monotonic()

    def fetch(
        self,
        url: str,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
        headers: dict[str, str] | None = None,
        check_robots: bool = True,
    ) -> FetchResult:
        if check_robots and not self.allowed_by_robots(url):
            parts = urlsplit(url)
            note = self._robots_note.get(f"{parts.scheme}://{parts.netloc}")
            if note:  # transient: robots.txt could not be read, not an explicit disallow
                raise FetchError(note)
            raise FetchError("robots.txt 不允许抓取该地址，已停止访问（需人工确认）", blocked=True)

        req_headers = dict(headers or {})
        if etag:
            req_headers["If-None-Match"] = etag
        if last_modified:
            req_headers["If-Modified-Since"] = last_modified

        host = urlsplit(url).netloc
        last_exc: Exception | None = None
        for attempt in range(1, self.retries + 1):
            self._throttle(host)
            try:
                resp = self.client.get(url, headers=req_headers)
            except httpx.TimeoutException as exc:
                last_exc = FetchError(f"请求超时（{self.timeout:.0f}s）")
                log.info("timeout %s (attempt %d): %s", url, attempt, exc)
            except httpx.HTTPError as exc:
                last_exc = FetchError(f"网络错误：{type(exc).__name__}: {exc}")
                log.info("network error %s (attempt %d): %s", url, attempt, exc)
            else:
                if resp.status_code == 304:
                    return FetchResult(url=str(resp.url), status=304, not_modified=True,
                                       etag=etag, last_modified=last_modified)
                if resp.status_code in (403, 429) and resp.headers.get("x-ratelimit-remaining") == "0":
                    raise FetchError(f"HTTP {resp.status_code}：API 速率限制已用尽，将在下次运行时重试",
                                     status=resp.status_code)
                if resp.status_code in (401, 403, 407, 451):
                    raise FetchError(
                        f"HTTP {resp.status_code}：访问受限（可能需要登录或被限制访问），不会尝试绕过",
                        status=resp.status_code, blocked=True)
                if resp.status_code in RETRY_STATUSES:
                    last_exc = FetchError(f"HTTP {resp.status_code}", status=resp.status_code)
                    if attempt < self.retries:
                        self.sleep(_retry_after(resp) or self.backoff ** attempt)
                    continue
                if resp.status_code >= 400:
                    raise FetchError(f"HTTP {resp.status_code}", status=resp.status_code)
                if len(resp.content) > MAX_BYTES:
                    raise FetchError(f"响应过大（>{MAX_BYTES // 1024 // 1024}MB），已放弃", status=resp.status_code)
                text = resp.text
                ctype = resp.headers.get("content-type", "")
                if "html" in ctype and _looks_like_challenge(text):
                    raise FetchError("页面要求人机验证或登录，不会尝试绕过（需人工确认）",
                                     status=resp.status_code, blocked=True)
                return FetchResult(
                    url=str(resp.url), status=resp.status_code, text=text,
                    etag=resp.headers.get("etag"), last_modified=resp.headers.get("last-modified"),
                    content_type=ctype,
                )
            if attempt < self.retries:
                self.sleep(self.backoff ** attempt)
        assert last_exc is not None
        raise last_exc


def _retry_after(resp: httpx.Response) -> float | None:
    value = resp.headers.get("retry-after")
    if not value:
        return None
    try:
        return min(float(value), 60.0)
    except ValueError:
        try:
            dt = parsedate_to_datetime(value)
            return max(0.0, min(60.0, dt.timestamp() - time.time()))
        except (TypeError, ValueError):
            return None


def _looks_like_challenge(html: str) -> bool:
    head = html[:20000].lower()
    # Only short pages: a long article that mentions "captcha" is not a challenge page.
    return len(html) < 30000 and any(m in head for m in CHALLENGE_MARKERS)
