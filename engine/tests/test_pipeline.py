import json
from datetime import timedelta

import httpx
import pytest

from changeradar.models import ChangeType, SourceStatus
from changeradar.pipeline import github_api_url, run
from changeradar.store import Store, StoreError, atomic_write_json

from .conftest import fixture_text, write_config

FEED_URL = "https://example.com/feed.xml"
JOBS_URL = "https://jobs.example.com/campus"
GH_API = "https://api.github.com/repos/example/tool/releases?per_page=30"

FEED = {"id": "blog", "name": "示例博客", "type": "rss", "url": FEED_URL, "category": "ai",
        "keywords": ["Agent", "model"], "priority": 4, "credibility": "official", "baseline_items": 2}
JOBS = {"id": "campus", "name": "示例校招", "type": "html", "url": JOBS_URL, "category": "jobs",
        "keywords": ["实习"], "priority": 5,
        "html": {"selector": ".jobs", "item_selector": "li.job", "title_selector": ".job-title", "date_selector": "time"}}
GH = {"id": "tool-releases", "name": "tool releases", "type": "github_releases",
      "url": "https://github.com/example/tool/releases", "category": "ai"}


@pytest.fixture
def dirs(tmp_path):
    return tmp_path / "config", tmp_path / "data"


def test_end_to_end_two_runs(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [FEED, JOBS], {"alert_keywords": ["实习"], "importance_threshold": 70})
    web.set(FEED_URL, fixture_text("feed_v1.xml"), content_type="application/rss+xml")
    web.set(JOBS_URL, fixture_text("jobs_v1.html"))

    s1 = run(config, data, fetcher=fetcher, now=now)
    assert s1.run.sources_ok == 2 and s1.run.sources_failed == 0
    assert all(e.change_type == ChangeType.INITIAL for e in s1.new_events)
    status = json.loads((data / "status.json").read_text())
    assert status["sources"]["blog"]["status"] == "ok"
    # Baseline items never trigger alerts.
    notes = json.loads((data / "notifications.json").read_text())["notifications"]
    assert not [n for n in notes if n["kind"] == "alert"]

    web.set(FEED_URL, fixture_text("feed_v2.xml"), content_type="application/rss+xml")
    web.set(JOBS_URL, fixture_text("jobs_v2.html"))
    later = now + timedelta(days=1)
    s2 = run(config, data, fetcher=fetcher, now=later)
    kinds = sorted((e.source_id, e.change_type.value) for e in s2.new_events)
    assert kinds == [("blog", "added"), ("blog", "added"), ("campus", "added"), ("campus", "added"),
                     ("campus", "removed")]
    agent_job = next(e for e in s2.new_events if e.title == "AI Agent 研发实习生")
    assert agent_job.deadline == "2026-10-30"
    assert agent_job.url == "https://jobs.example.com/jobs/104?utm_source=x"
    assert "实习" in agent_job.alert_keywords
    assert agent_job.published_at is not None

    status = json.loads((data / "status.json").read_text())
    assert status["sources"]["campus"]["status"] == "changed"
    assert status["sources"]["campus"]["last_change_at"].startswith("2026-10-11")
    notes = json.loads((data / "notifications.json").read_text())["notifications"]
    alerts = [n for n in notes if n["kind"] == "alert"]
    assert len(alerts) == 1  # batched
    assert agent_job.id in alerts[0]["event_ids"]
    assert (data / "digests" / "2026-10-11.md").exists()

    # Third run with identical content: no duplicates, no new alerts.
    s3 = run(config, data, fetcher=fetcher, now=later + timedelta(hours=1))
    assert s3.new_events == []
    events = json.loads((data / "events.json").read_text())["events"]
    assert len(events) == len({e["id"] for e in events})
    notes = json.loads((data / "notifications.json").read_text())["notifications"]
    assert len([n for n in notes if n["kind"] == "alert"]) == 1
    status = json.loads((data / "status.json").read_text())
    assert status["sources"]["blog"]["status"] == "unchanged"
    assert s3.persist is True  # status transition changed → unchanged is worth recording

    # Fourth identical run within the heartbeat interval → nothing worth committing.
    s4 = run(config, data, fetcher=fetcher, now=later + timedelta(hours=2))
    assert s4.persist is False
    # …but a day later the daily heartbeat is persisted so check times stay fresh in git.
    s5 = run(config, data, fetcher=fetcher, now=later + timedelta(days=1))
    assert s5.persist is True and s5.persist_reason == "daily-heartbeat"


def test_failure_keeps_history_and_snapshot(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [FEED])
    web.set(FEED_URL, fixture_text("feed_v1.xml"))
    run(config, data, fetcher=fetcher, now=now)
    snap_before = (data / "snapshots" / "blog.json").read_text()
    events_before = json.loads((data / "events.json").read_text())["events"]

    def timeout(req):
        raise httpx.ConnectTimeout("down", request=req)

    web.set_handler(FEED_URL, timeout)
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    assert s.run.sources_failed == 1
    st = json.loads((data / "status.json").read_text())["sources"]["blog"]
    assert st["status"] == "fetch_error" and "超时" in st["message"]
    assert st["last_success_at"].startswith("2026-10-10")  # last *successful* check kept
    assert st["consecutive_failures"] == 1
    assert (data / "snapshots" / "blog.json").read_text() == snap_before
    assert json.loads((data / "events.json").read_text())["events"] == events_before
    notes = json.loads((data / "notifications.json").read_text())["notifications"]
    assert [n["kind"] for n in notes].count("system") == 1

    # Still failing next day → no second system notification.
    run(config, data, fetcher=fetcher, now=now + timedelta(days=2))
    notes = json.loads((data / "notifications.json").read_text())["notifications"]
    assert [n["kind"] for n in notes].count("system") == 1


def test_parse_error_and_structure_change_guard(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [JOBS])
    web.set(JOBS_URL, fixture_text("jobs_v1.html"))
    run(config, data, fetcher=fetcher, now=now)
    web.set(JOBS_URL, "<html><body><div class='jobs'><p>系统维护中</p></div></body></html>")
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    st = json.loads((data / "status.json").read_text())["sources"]["campus"]
    assert st["status"] == "parse_error"
    assert s.new_events == []  # no flood of "removed" events
    assert len(json.loads((data / "snapshots" / "campus.json").read_text())["items"]) == 3


def test_304_not_modified(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [FEED])
    web.set(FEED_URL, fixture_text("feed_v1.xml"), headers={"etag": '"v1"'})
    run(config, data, fetcher=fetcher, now=now)

    def conditional(req):
        assert req.headers.get("if-none-match") == '"v1"'
        return httpx.Response(304)

    web.set_handler(FEED_URL, conditional)
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    assert s.new_events == []
    assert json.loads((data / "status.json").read_text())["sources"]["blog"]["status"] == "unchanged"


def test_robots_blocked_source(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [FEED])
    web.set("https://example.com/robots.txt", "User-agent: *\nDisallow: /", content_type="text/plain")
    web.set(FEED_URL, fixture_text("feed_v1.xml"))
    run(config, data, fetcher=fetcher, now=now)
    st = json.loads((data / "status.json").read_text())["sources"]["blog"]
    assert st["status"] == "blocked"
    assert FEED_URL not in [str(c.url) for c in web.calls]


def test_paused_source_is_not_fetched(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [{**FEED, "enabled": False}])
    s = run(config, data, fetcher=fetcher, now=now)
    assert s.run.sources_paused == 1 and web.calls == []
    assert json.loads((data / "status.json").read_text())["sources"]["blog"]["status"] == "paused"


def test_exclude_and_require_keywords(dirs, web, fetcher, now):
    config, data = dirs
    src = {**FEED, "baseline_items": 0, "exclude_keywords": ["advisory"], "require_keywords": True,
           "keywords": ["model", "advisory"]}
    write_config(config, [src])
    web.set(FEED_URL, fixture_text("feed_v1.xml"))
    run(config, data, fetcher=fetcher, now=now)
    web.set(FEED_URL, fixture_text("feed_v2.xml"))
    s = run(config, data, fetcher=fetcher, now=now + timedelta(days=1))
    assert [e.title for e in s.new_events] == ["Open-source model release: Example-LLM 7B"]
    assert s.run.filtered == 1


def test_github_releases_use_api_and_token(dirs, web, fetcher, now, monkeypatch):
    config, data = dirs
    write_config(config, [GH])
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    seen = {}

    def handler(req):
        seen["auth"] = req.headers.get("authorization")
        return httpx.Response(200, text=fixture_text("github_releases.json"), headers={"content-type": "application/json"})

    web.set_handler(GH_API, handler)
    s = run(config, data, fetcher=fetcher, now=now)
    assert seen["auth"] == "Bearer test-token"
    assert len(s.new_events) == 2
    # The token must never be written to disk.
    for f in data.rglob("*"):
        if f.is_file():
            assert "test-token" not in f.read_text()


def test_github_api_url():
    from changeradar.models import Source
    src = Source(id="gh-x", name="x", type="github_releases", url="https://github.com/anthropics/claude-code/releases",
                 category="ai")
    assert github_api_url(src) == "https://api.github.com/repos/anthropics/claude-code/releases?per_page=30"
    # Huge release notes: only request as many releases as will be kept.
    assert github_api_url(src.model_copy(update={"max_items": 5})).endswith("per_page=5")


def test_cross_source_duplicates_are_skipped(dirs, web, fetcher, now):
    config, data = dirs
    mirror = {**FEED, "id": "mirror", "name": "镜像", "url": "https://mirror.example.org/feed.xml"}
    write_config(config, [FEED, mirror])
    web.set(FEED_URL, fixture_text("feed_v1.xml"))
    web.set("https://mirror.example.org/feed.xml", fixture_text("feed_v1.xml"))
    s = run(config, data, fetcher=fetcher, now=now)
    assert [e.source_id for e in s.new_events] == ["blog", "blog"]
    assert s.run.duplicates == 2


def test_corrupted_data_file_is_never_overwritten(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [FEED])
    data.mkdir(parents=True)
    (data / "events.json").write_text("{ broken")
    web.set(FEED_URL, fixture_text("feed_v1.xml"))
    with pytest.raises(StoreError):
        run(config, data, fetcher=fetcher, now=now)
    assert (data / "events.json").read_text() == "{ broken"


def test_atomic_write_leaves_no_temp_files(tmp_path):
    atomic_write_json(tmp_path / "a.json", {"x": 1})
    assert [p.name for p in tmp_path.iterdir()] == ["a.json"]


def test_events_overflow_moves_to_archive(tmp_path, now):
    from changeradar.models import Event
    store = Store(tmp_path)
    evs = [Event(id=f"e{i}", source_id="s", source_name="s", category="ai", change_type=ChangeType.ADDED,
                 title=f"t{i}", url=f"https://e.com/{i}", detected_at=now - timedelta(days=i)) for i in range(1003)]
    store.save_events(evs, now)
    assert len(json.loads((tmp_path / "events.json").read_text())["events"]) == 1000
    assert store.archived_event_ids() == {"e1000", "e1001", "e1002"}
    assert json.loads((tmp_path / "archive" / "index.json").read_text())["months"][0]["count"] == 3


def test_removed_source_drops_state(dirs, web, fetcher, now):
    config, data = dirs
    write_config(config, [FEED])
    web.set(FEED_URL, fixture_text("feed_v1.xml"))
    run(config, data, fetcher=fetcher, now=now)
    write_config(config, [{**FEED, "enabled": False, "id": "other"}])
    s = run(config, data, fetcher=fetcher, now=now + timedelta(minutes=5))
    assert "blog" not in json.loads((data / "status.json").read_text())["sources"]
    assert s.persist is True


def test_invalid_config_touches_nothing(dirs):
    from changeradar.config import ConfigError
    config, data = dirs
    write_config(config, [{**FEED, "category": "missing"}])
    with pytest.raises(ConfigError, match="不存在的分类"):
        run(config, data)
    assert not data.exists()


def test_source_status_enum_values_are_stable():
    # The frontend relies on these exact strings.
    assert {s.value for s in SourceStatus} == {"pending", "ok", "unchanged", "changed", "fetch_error",
                                               "parse_error", "paused", "blocked"}
