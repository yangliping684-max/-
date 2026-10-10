from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

import httpx
import pytest

from changeradar.fetcher import Fetcher

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 10, 10, 8, 0, tzinfo=UTC)


def fixture_text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture
def now() -> datetime:
    return NOW


class FakeWeb:
    """Routes URL → handler; handlers return (status, body, headers) or raise."""

    def __init__(self) -> None:
        self.routes: dict[str, Callable[[httpx.Request], httpx.Response]] = {}
        self.calls: list[httpx.Request] = []

    def set(self, url: str, body: str = "", status: int = 200, headers: dict[str, str] | None = None,
            content_type: str = "text/html; charset=utf-8") -> None:
        def handler(req: httpx.Request) -> httpx.Response:
            h = {"content-type": content_type, **(headers or {})}
            return httpx.Response(status, text=body, headers=h)
        self.routes[url] = handler

    def set_handler(self, url: str, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self.routes[url] = handler

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.calls.append(req)
        url = str(req.url)
        if url in self.routes:
            return self.routes[url](req)
        if url.endswith("/robots.txt"):
            return httpx.Response(404, text="")
        return httpx.Response(404, text="not found")


@pytest.fixture
def web() -> FakeWeb:
    return FakeWeb()


@pytest.fixture
def fetcher(web: FakeWeb) -> Fetcher:
    client = httpx.Client(transport=httpx.MockTransport(web), follow_redirects=True)
    return Fetcher(client=client, sleep=lambda s: None, min_host_interval=0, retries=2)


def write_config(config_dir: Path, sources: list[dict], rules: dict | None = None) -> None:
    config_dir.mkdir(parents=True, exist_ok=True)
    cfg = {
        "version": 1,
        "categories": [{"id": "ai", "name": "AI 与科技"}, {"id": "jobs", "name": "实习与招聘"},
                       {"id": "edu", "name": "学术与教育"}],
        "sources": sources,
    }
    (config_dir / "sources.json").write_text(json.dumps(cfg, ensure_ascii=False), encoding="utf-8")
    if rules is not None:
        (config_dir / "rules.json").write_text(json.dumps(rules, ensure_ascii=False), encoding="utf-8")
